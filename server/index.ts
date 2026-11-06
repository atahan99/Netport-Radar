// server/index.ts
// netport-radar live capture entry. Wires capture → flow tracker → WS hub, and
// decides between inline capture and the privilege-separated broker.

import { execSync, fork } from 'child_process';
import * as os from 'os';
import net from 'net';
import { lookup } from 'dns/promises';
import { writeFileSync, mkdirSync, mkdtempSync, chownSync, rmSync, existsSync, statSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import type { BackendInfo, HomeAirport } from '../src/types';
import {
  detectBackend,
  detectHomeAirports,
  haversineKm,
  startCapture,
  startDecoder,
  type CaptureBackend,
  type RawPacket,
  type Decoder,
} from './capture';
import { FlowTracker } from './flow-tracker';
import { WsHub } from './ws';
import { serveDist } from './static';
import { resolvePrimaryHome, HOME_PROBE_HOSTS } from './home';
import { resolveDropTarget, dropPrivileges, assertPrivilegesDropped, type DropTarget } from './privdrop';
import { superviseCapture } from './capture-supervisor';
import { startPcapReceiver } from './pcap-socket';
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
    for (const host of HOME_PROBE_HOSTS) {
      try {
        for (const a of await lookup(host, { all: true })) selfProbeIps.add(a.address);
      } catch {
        /* offline / no DNS — fine */
      }
    }
  })();

  // `tracker` is created below; init only runs once clients connect.
  const ws = new WsHub(WS_PORT, () => ({ homeAirports, backend: backendInfo, flights: tracker.snapshot() }), {
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
  // geoLookup returns null → no extras. Only broadcasts when
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
    const sup = superviseCapture(
      (onError) => startCapture(backend, iface, getLocalIps(), ingest, onError),
      {
        permission: () =>
          ws.error('capture_permission', 'No capture permission — run with sudo (see README).'),
        error: (msg) => {
          console.error('[capture]', msg);
          ws.error('capture_error', msg);
        },
        restarting: () => ws.error('capture_error', 'Capture process exited — restarting…'),
        dead: () =>
          ws.error('capture_dead', 'Capture keeps dying — check permissions or the interface (see README).'),
        noBackend: () =>
          ws.error('no_backend', 'No capture backend available — install Wireshark (tshark).'),
      },
    );
    startProcessPolling();
    return {
      switchTo: () => sup.restart(), // spawn reads the already-updated `iface`
      stop: () => {
        sup.stop();
        stopProcessPolling();
      },
    };
  }

  // Brokered path: fork the root broker, wire its IPC into the tracker/WS, then
  // drop this process to the invoking user. The broker owns tshark + lsof.
  async function startBrokeredCapture(target: DropTarget): Promise<CaptureControl> {
    // Still root here. The pcap socket lives in a fresh 0700 dir handed to the
    // invoking user, so after the drop only we (and root) can reach it.
    const sockDir = mkdtempSync(join(os.tmpdir(), 'netport-'));
    chownSync(sockDir, target.uid, target.gid);
    const sockPath = join(sockDir, 'pcap.sock');
    const nonce = randomBytes(16).toString('hex');
    let decoder: Decoder | null = null;
    const pcapServer = await startPcapReceiver(sockPath, nonce, (sock) => {
      decoder?.stop(); // a new capture instance (restart / iface switch) replaces the old stream
      decoder = startDecoder(backend, sock, getLocalIps(), ingest, (msg) =>
        ws.error('capture_error', msg.slice(0, 200)),
      );
    });

    const broker = fork(join(import.meta.dirname, 'priv-broker.ts'), [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    broker.on('message', (m: BrokerOut) => {
      switch (m.t) {
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
    sendBroker({ t: 'init', backend, iface, sockPath, nonce });
    sendProcessBoost = () => sendBroker({ t: 'boost' }); // the broker owns lsof
    dropPrivileges(target); // everything below this line runs as the invoking user
    assertPrivilegesDropped(true);
    return {
      switchTo: (next) => sendBroker({ t: 'switch', iface: next }),
      stop: () => {
        sendBroker({ t: 'stop' });
        broker.kill();
        decoder?.stop();
        pcapServer.close();
        rmSync(sockDir, { recursive: true, force: true });
      },
    };
  }

  const dropTarget = resolveDropTarget();
  const capture: CaptureControl = dropTarget
    ? await startBrokeredCapture(dropTarget)
    : startInlineCapture();
  if (!dropTarget) assertPrivilegesDropped(false);

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
      publishHomes(); // re-derive the VPN flag for the new iface before init goes out
      ws.broadcastInit();
    }
  };

  if (process.env.SERVE_DIST) {
    const distDir = join(import.meta.dirname, '..', 'dist');
    serveDist(distDir, HTTP_PORT, BIND_HOST);
    if (existsSync(distDir) && statSync(distDir).uid === 0 && process.getuid?.() !== 0) {
      console.warn('[serve] dist/ is owned by root (built under sudo). Fix: sudo chown -R "$USER" dist');
    }
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
    // Opt-in: the log is a full record of who you talked to, so it only hits
    // disk when NETPORT_SESSION_LOG names a directory.
    const logDir = process.env.NETPORT_SESSION_LOG;
    const ndjson = logDir ? exportNdjson() : '';
    if (logDir && ndjson) {
      const file = join(logDir, `netport-radar-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
      try {
        mkdirSync(logDir, { recursive: true, mode: 0o700 });
        writeFileSync(file, ndjson + '\n', { mode: 0o600 });
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
