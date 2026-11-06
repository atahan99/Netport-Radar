// server/index.ts
// netport-radar live capture entry. Wires capture → flow-tracker → ws.
//
// HOME LOCATION: behind NAT the captured source IP is private (192.168.x), so
// it can't be geolocated. To place your home airport we do ONE external lookup
// of your public IP's location via ip-api.com (city-accurate; geoip-lite's
// bundled DB is only country-accurate and often mislabels the city). This is
// the only thing that leaves the machine. Set NETPORT_HOME_LAT / NETPORT_HOME_LNG
// (+ NETPORT_HOME_LABEL) to skip it entirely.

import { execSync, fork, type ChildProcess } from 'child_process';
import * as os from 'os';
import net from 'net';
import { lookup } from 'dns/promises';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BackendInfo, HomeAirport } from '../src/types';
import {
  detectBackend,
  detectHomeAirports,
  geoLookup,
  haversineKm,
  startCapture,
  type CaptureBackend,
  type RawPacket,
} from './capture';
import { FlowTracker } from './flow-tracker';
import { WsHub } from './ws';
import { serveDist } from './static';
import { logEvent, exportNdjson, resetLog } from './logger';
import {
  startProcessPolling,
  stopProcessPolling,
  setProcessTable,
  noteLookupMiss,
} from './process-names';
import type { BrokerIn, BrokerOut } from './priv-broker';
import { WS_PORT, HTTP_PORT, BIND_HOST, IS_LOCAL_BIND, TOKEN } from './config';

function getDefaultInterface(): string {
  try {
    if (process.platform === 'darwin') {
      const m = execSync('route -n get default 2>/dev/null').toString().match(/interface:\s*(\w+)/);
      if (m) return m[1];
    } else if (process.platform === 'linux') {
      const m = execSync('ip route show default 2>/dev/null').toString().match(/dev\s+(\w+)/);
      if (m) return m[1];
    }
  } catch {
    /* fall through */
  }
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (addrs?.some((a) => a.family === 'IPv4' && !a.internal)) return name;
  }
  return 'en0';
}

function getLocalIps(): Set<string> {
  const set = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) set.add(a.address);
  }
  return set;
}

interface IpapiCoResp {
  latitude: number;
  longitude: number;
  city: string;
  country_code: string;
  ip: string;
}

interface IpApiResp {
  status: string;
  country: string;
  countryCode: string;
  city: string;
  lat: number;
  lon: number;
  query: string;
}

// Home airport from the public IP — still exactly ONE outbound lookup per
// session, just HTTPS-first now: ipapi.co (HTTPS) → ip-api.com (HTTP-only free
// tier) → ipify + local geoip-lite (country-accurate). Env override skips all.
async function resolvePrimaryHome(): Promise<HomeAirport> {
  const { NETPORT_HOME_LAT, NETPORT_HOME_LNG, NETPORT_HOME_LABEL } = process.env;
  if (NETPORT_HOME_LAT && NETPORT_HOME_LNG) {
    return {
      id: 'primary',
      label: NETPORT_HOME_LABEL ?? 'Home',
      lat: Number(NETPORT_HOME_LAT),
      lng: Number(NETPORT_HOME_LNG),
      ip: '',
      isVpn: false,
    };
  }
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as IpapiCoResp;
    if (typeof j.latitude === 'number' && typeof j.longitude === 'number') {
      return {
        id: 'primary',
        label: j.city ? `${j.city}, ${j.country_code}` : (j.country_code ?? 'Home'),
        lat: j.latitude,
        lng: j.longitude,
        ip: j.ip ?? '',
        isVpn: false,
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await fetch(
      'http://ip-api.com/json/?fields=status,country,countryCode,city,lat,lon,query',
      { signal: AbortSignal.timeout(4000) },
    );
    const j = (await r.json()) as IpApiResp;
    if (j.status === 'success') {
      return {
        id: 'primary',
        label: j.city ? `${j.city}, ${j.countryCode}` : j.country,
        lat: j.lat,
        lng: j.lon,
        ip: j.query,
        isVpn: false,
      };
    }
  } catch {
    /* fall through to the local DB */
  }
  try {
    const ip = (
      await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) })).text()
    ).trim();
    const geo = geoLookup(ip);
    if (geo) {
      return {
        id: 'primary',
        label: geo.city ? `${geo.city}, ${geo.country}` : geo.country,
        lat: geo.lat,
        lng: geo.lng,
        ip,
        isVpn: false,
      };
    }
  } catch {
    /* offline */
  }
  return { id: 'primary', label: 'Local', lat: 0, lng: 0, ip: '', isVpn: false };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execSync(`${cmd} "${url}"`);
  } catch {
    /* best effort */
  }
}

function getInterfaces(): string[] {
  const names = new Set<string>();
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (addrs?.some((a) => !a.internal)) names.add(name);
  }
  return [...names];
}

// Preflight: is `port` free on our bind host? Run before standing up the WS
// server so a busy port produces a clear instruction instead of an uncaught
// EADDRINUSE.
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, BIND_HOST);
  });
}

// First non-internal IPv4 — only for printing the "open from another device" URL.
function lanIp(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

// Privilege separation: capturing needs root, but the long-running network-facing
// servers (WS control channel, HTTP, flow tracker) should not. When started via
// sudo on a POSIX host we keep the root-only work (tshark/tcpdump spawn + lsof) in
// a small broker child and drop the main process to the invoking user. If we
// can't (not root, not via sudo, Windows, or opted out), everything runs inline
// exactly as before — no behavior change.
function resolveDropTarget(): { uid: number; gid: number } | null {
  if (process.env.NETPORT_NO_PRIVDROP) return null;
  if (process.platform === 'win32') return null;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  // Need a real non-root target (sudo from a normal user sets SUDO_UID/GID).
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0) return null;
  return { uid, gid };
}

function dropPrivileges(target: { uid: number; gid: number }): void {
  try {
    process.setgid?.(target.gid);
    try {
      process.setgroups?.([target.gid]); // shed supplementary groups (e.g. wheel)
    } catch {
      /* non-fatal on some platforms */
    }
    process.setuid?.(target.uid); // must be last — can't change gid after
    console.log(
      `[security] dropped to uid=${target.uid} gid=${target.gid}; capture runs in the root broker.`,
    );
  } catch (e) {
    // The broker is already forked; if the drop fails we keep running as before
    // (servers root) rather than aborting — no worse than the pre-change state.
    console.error('[security] privilege drop failed — continuing as root:', e);
  }
}

function assertPrivilegesDropped(brokered: boolean, wsHub: WsHub): void {
  if (typeof process.getuid !== 'function') return;
  const uid = process.getuid();
  console.log(`[security] effective uid=${uid}${brokered ? ' (brokered; capture in root child)' : ''}`);
  if (!brokered) return;
  if (uid === 0) {
    console.error(
      '[security] brokered run still executing as root after dropPrivileges — WS/HTTP must not stay root.',
    );
    wsHub.error(
      'privilege_drop_failed',
      'Server still running as root after privilege drop — fix sudo (SUDO_UID/GID) or use NETPORT_NO_PRIVDROP=1 intentionally.',
    );
  }
}

async function main(): Promise<void> {
  if (!(await isPortFree(WS_PORT))) {
    console.error(
      `\n[fatal] Port ${WS_PORT} is already in use — another netport-radar may be running.`,
    );
    console.error(`        Free it and retry:  lsof -ti tcp:${WS_PORT} | xargs kill\n`);
    process.exit(1);
  }

  if (process.env.SERVE_DIST && !(await isPortFree(HTTP_PORT))) {
    console.error(
      `\n[fatal] Port ${HTTP_PORT} is already in use — another netport-radar may be running.`,
    );
    console.error(`        Free it and retry:  lsof -ti tcp:${HTTP_PORT} | xargs kill\n`);
    process.exit(1);
  }

  if (!IS_LOCAL_BIND) {
    console.warn(`\n[security] binding ${BIND_HOST} — devices on your network can reach this server.`);
    console.warn(`[security] connections require the token below (new one every start).`);
    const ip = lanIp();
    if (ip) console.warn(`[security] from another device: http://${ip}:${HTTP_PORT}/?token=${TOKEN}\n`);
  }

  const backend: CaptureBackend = detectBackend();
  let iface = process.env.NETPORT_IFACE ?? getDefaultInterface();
  const backendInfo: BackendInfo = {
    capture: backend,
    dpiMode: backend === 'tshark' ? 'full' : 'port-based',
    iface,
    interfaces: getInterfaces(),
  };
  let homeAirports: HomeAirport[] = [];

  // The geo-lookup providers we contact at boot — their IPs must not become
  // flights. Resolved once, best-effort.
  const selfProbeIps = new Set<string>();
  void (async () => {
    for (const host of ['ipapi.co', 'ip-api.com', 'api.ipify.org']) {
      try {
        for (const a of await lookup(host, { all: true })) selfProbeIps.add(a.address);
      } catch {
        /* offline / no DNS — fine */
      }
    }
  })();

  const ws = new WsHub(WS_PORT, () => ({ homeAirports, backend: backendInfo }), {
    host: BIND_HOST,
    token: TOKEN,
  });
  // Capturing on a VPN tunnel interface → the home airport is a VPN exit.
  const VPN_IFACE = /^(utun|tun|tap|wg|ppp)/i;
  let primaryHome: HomeAirport | null = null;
  let lastHomeSig = '';
  const sourceIpHits = new Map<string, number>();

  // Single source of truth for homeAirports: the ip-api primary, VPN-flagged if
  // we're on a tunnel interface, plus any extra clusters of observed *public*
  // source IPs (multi-homed hosts). Behind home NAT the source IP is private →
  // geoLookup returns null → no extras, exactly as before. Only broadcasts when
  // the set actually changes (the 10s timer is otherwise a no-op).
  function publishHomes(): void {
    if (!primaryHome) return;
    const homes: HomeAirport[] = [{ ...primaryHome }];
    if (VPN_IFACE.test(iface)) {
      homes[0].isVpn = true;
      if (!/\(VPN\)$/.test(homes[0].label)) homes[0].label += ' (VPN)';
    }
    for (const d of detectHomeAirports([...sourceIpHits.keys()])) {
      if (homes.length >= 3) break;
      if (haversineKm(d.lat, d.lng, homes[0].lat, homes[0].lng) > 100) {
        const label = /\(VPN\)$/.test(d.label) ? d.label : `${d.label} (VPN)`;
        homes.push({ ...d, id: `vpn-${homes.length}`, isVpn: true, label });
      }
    }
    homeAirports = homes;
    const sig = homes.map((h) => `${h.id}:${h.lat.toFixed(3)},${h.lng.toFixed(3)},${h.isVpn}`).join('|');
    if (sig === lastHomeSig) return;
    lastHomeSig = sig;
    ws.homeUpdate(homeAirports);
  }

  // Adaptive lsof boost: inline mode polls directly; brokered mode forwards a
  // (debounced) IPC nudge to the root broker, which owns the poller.
  let sendProcessBoost: () => void = () => noteLookupMiss();
  let lastBoostSent = 0;
  const onProcessMiss = () => {
    const now = Date.now();
    if (now - lastBoostSent < 300) return;
    lastBoostSent = now;
    sendProcessBoost();
  };

  const tracker = new FlowTracker({
    getHomeAirports: () => homeAirports,
    onEvent: (e) => {
      ws.enqueue(e);
      logEvent(e);
    },
    onSourceIp: (ip) => sourceIpHits.set(ip, (sourceIpHits.get(ip) ?? 0) + 1),
    selfProbeIps,
    onProcessMiss,
  });

  // Packets flowing again means capture recovered from any earlier error.
  const ingest = (p: RawPacket) => {
    ws.clearError();
    tracker.ingest(p);
  };

  const refreshHome = () =>
    void resolvePrimaryHome().then((home) => {
      primaryHome = home;
      publishHomes();
      console.log(`[home] ${home.label} (${home.lat.toFixed(2)}, ${home.lng.toFixed(2)})`);
    });
  refreshHome();
  // Re-cluster periodically so a newly-seen public source IP can add a VPN exit.
  const clusterTimer = setInterval(publishHomes, 10_000);

  let shuttingDown = false;

  // Capture + lsof are the only root-only operations. When we can drop privileges
  // (sudo on POSIX), they run in a root broker child and this process drops to the
  // invoking user; otherwise they run inline, exactly as before.
  interface CaptureControl {
    switchTo(iface: string): void;
    stop(): void;
  }

  // Inline path (no privilege drop): spawn capture here and poll lsof here.
  function startInlineCapture(): CaptureControl {
    let captureProc: ChildProcess | null = null;
    let permissionDenied = false;
    let restartCount = 0;
    let lastRestart = 0;

    const onCaptureError = (msg: string) => {
      console.error('[capture]', msg);
      if (/permission|denied|bpf|root|operation not permitted/i.test(msg)) {
        permissionDenied = true; // a restart won't fix this — let the banner stand
        ws.error('capture_permission', 'No capture permission — run with sudo (see README).');
      } else {
        ws.error('capture_error', msg.slice(0, 200));
      }
    };

    // Supervisor: a capture process that dies (sleep/wake, interface flap) is
    // restarted once; a second death within 30s is declared dead. An intentional
    // kill (switch/shutdown) is distinguished by proc identity.
    function spawnCapture(): void {
      const proc = startCapture(backend, iface, getLocalIps(), ingest, onCaptureError);
      captureProc = proc;
      if (!proc) {
        ws.error('no_backend', 'No capture backend available — install Wireshark (tshark).');
        return;
      }
      proc.on('exit', () => {
        if (proc !== captureProc || shuttingDown || permissionDenied) return;
        const now = Date.now();
        const recent = now - lastRestart < 30_000;
        if (recent && restartCount >= 1) {
          ws.error('capture_dead', 'Capture keeps dying — check permissions or the interface (see README).');
          return;
        }
        restartCount = recent ? restartCount + 1 : 1;
        lastRestart = now;
        ws.error('capture_error', 'Capture process exited — restarting…');
        setTimeout(() => {
          if (proc === captureProc && !shuttingDown && !permissionDenied) spawnCapture();
        }, 2000);
      });
    }
    spawnCapture();
    startProcessPolling();
    return {
      switchTo: () => {
        permissionDenied = false;
        restartCount = 0;
        captureProc?.kill(); // its exit handler no-ops once spawnCapture reassigns
        spawnCapture();
      },
      stop: () => {
        captureProc?.kill();
        stopProcessPolling();
      },
    };
  }

  // Brokered path: fork the root broker, wire its IPC into the tracker/WS, then
  // drop this process to the invoking user. The broker owns tshark + lsof.
  function startBrokeredCapture(target: { uid: number; gid: number }): CaptureControl {
    const broker = fork(join(import.meta.dirname, 'priv-broker.ts'), [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    broker.on('message', (m: BrokerOut) => {
      switch (m.t) {
        case 'pkts':
          for (const p of m.pkts) ingest(p);
          break;
        case 'proc':
          setProcessTable(m.entries);
          break;
        case 'permission':
          ws.error('capture_permission', 'No capture permission — run with sudo (see README).');
          break;
        case 'err':
          ws.error('capture_error', m.msg);
          break;
        case 'dead':
          ws.error('capture_dead', 'Capture keeps dying — check permissions or the interface (see README).');
          break;
        case 'restarting':
          ws.error('capture_error', 'Capture process exited — restarting…');
          break;
        case 'no_backend':
          ws.error('no_backend', 'No capture backend available — install Wireshark (tshark).');
          break;
      }
    });
    broker.on('exit', () => {
      if (!shuttingDown) ws.error('capture_dead', 'Capture broker exited unexpectedly.');
    });
    const sendBroker = (m: BrokerIn) => {
      try {
        broker.send(m);
      } catch {
        /* broker gone */
      }
    };
    sendBroker({ t: 'init', backend, iface });
    sendProcessBoost = () => sendBroker({ t: 'boost' }); // the broker owns lsof
    dropPrivileges(target); // everything below this line runs as the invoking user
    assertPrivilegesDropped(true, ws);
    return {
      switchTo: (next) => sendBroker({ t: 'switch', iface: next }),
      stop: () => {
        sendBroker({ t: 'stop' });
        broker.kill();
      },
    };
  }

  const dropTarget = resolveDropTarget();
  const capture: CaptureControl = dropTarget
    ? startBrokeredCapture(dropTarget)
    : startInlineCapture();
  if (!dropTarget) assertPrivilegesDropped(false, ws);

  ws.onClient = (msg, reply) => {
    if (msg.type === 'export') {
      reply({ type: 'log', ndjson: exportNdjson() });
    } else if (msg.type === 'switch_iface' && msg.iface !== iface) {
      // Interface names come over the wire — only accept ones that exist.
      if (!getInterfaces().includes(msg.iface)) {
        reply({ type: 'error', code: 'bad_iface', message: `Unknown interface "${msg.iface.slice(0, 32)}"` });
        return;
      }
      console.log(`[iface] switching to ${msg.iface}`);
      tracker.clear();
      resetLog();
      ws.reset();
      iface = msg.iface;
      backendInfo.iface = iface;
      sourceIpHits.clear();
      refreshHome();
      capture.switchTo(iface);
      ws.broadcastInit();
    }
  };

  if (process.env.SERVE_DIST) {
    serveDist(join(import.meta.dirname, '..', 'dist'), HTTP_PORT, BIND_HOST);
    // Local open works on any bind; the token rides the URL so the page can
    // hand it to the WS (only set for non-local binds).
    openBrowser(`http://localhost:${HTTP_PORT}${TOKEN ? `/?token=${TOKEN}` : ''}`);
  }

  console.log(
    `netport-radar live · backend=${backend} dpi=${backendInfo.dpiMode} iface=${iface} ws=${WS_PORT}`,
  );

  const shutdown = () => {
    shuttingDown = true;
    clearInterval(clusterTimer);
    capture.stop();
    tracker.stop();
    ws.stop();
    // Flush the session log to disk (the master plan promised this on clean close).
    const ndjson = exportNdjson();
    if (ndjson) {
      // Keep session logs out of the repo root: write under plans/session-logs/
      // (gitignored). Created on demand.
      const dir = join(process.cwd(), 'plans', 'session-logs');
      const file = join(dir, `netport-radar-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, ndjson + '\n');
        console.log(`\n[log] session written to ${file}`);
      } catch (e) {
        console.error('[log] failed to write session log:', e);
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
