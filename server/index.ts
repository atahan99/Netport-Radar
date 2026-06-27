// server/index.ts
// netport-radar live capture entry. Wires capture → flow-tracker → ws.
//
// HOME LOCATION: behind NAT the captured source IP is private (192.168.x), so
// it can't be geolocated. To place your home airport we do ONE external lookup
// of your public IP's location via ip-api.com (city-accurate; geoip-lite's
// bundled DB is only country-accurate and often mislabels the city). This is
// the only thing that leaves the machine. Set NETPORT_HOME_LAT / NETPORT_HOME_LNG
// (+ NETPORT_HOME_LABEL) to skip it entirely.

import { execSync } from 'child_process';
import * as os from 'os';
import http from 'http';
import net from 'net';
import { lookup } from 'dns/promises';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { BackendInfo, HomeAirport } from '../src/types';
import { detectBackend, geoLookup, startCapture, type CaptureBackend } from './capture';
import { FlowTracker } from './flow-tracker';
import { WsHub } from './ws';
import { logEvent, exportNdjson, resetLog } from './logger';
import { startProcessPolling, stopProcessPolling } from './process-names';
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

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveDist(): void {
  const dir = join(import.meta.dirname, '..', 'dist');
  if (!existsSync(dir)) {
    console.warn('[serve] dist/ not found — run `npm run build` first');
    return;
  }
  http
    .createServer((req, res) => {
      const rel = (req.url ?? '/').split('?')[0];
      let file = join(dir, rel);
      if (!existsSync(file) || rel === '/' || rel.endsWith('/')) file = join(dir, 'index.html');
      try {
        const data = readFileSync(file);
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end('not found');
      }
    })
    .listen(HTTP_PORT, BIND_HOST, () =>
      console.log(`[serve] dist on http://localhost:${HTTP_PORT} (bound ${BIND_HOST})`),
    );
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

  if (!IS_LOCAL_BIND) {
    console.warn(`\n[security] binding ${BIND_HOST} — devices on your network can reach this server.`);
    console.warn(`[security] connections require the token below (new one every start).`);
    const ip = lanIp();
    if (ip) console.warn(`[security] from another device: http://${ip}:${HTTP_PORT}/?token=${TOKEN}\n`);
  }

  const backend: CaptureBackend = detectBackend();
  let iface = process.env.NETPORT_IFACE ?? getDefaultInterface();
  let localIps = getLocalIps();
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
  const tracker = new FlowTracker({
    getHomeAirports: () => homeAirports,
    onEvent: (e) => {
      ws.enqueue(e);
      logEvent(e);
    },
    onSourceIp: () => {},
    selfProbeIps,
  });

  const refreshHome = () =>
    void resolvePrimaryHome().then((home) => {
      homeAirports = [home];
      ws.homeUpdate(homeAirports);
      console.log(`[home] ${home.label} (${home.lat.toFixed(2)}, ${home.lng.toFixed(2)})`);
    });
  refreshHome();

  const onCaptureError = (msg: string) => {
    console.error('[capture]', msg);
    if (/permission|denied|bpf|root|operation not permitted/i.test(msg)) {
      ws.error('capture_permission', 'No capture permission — run with sudo (see README).');
    } else {
      ws.error('capture_error', msg.slice(0, 200));
    }
  };

  let captureProc = startCapture(backend, iface, localIps, (p) => tracker.ingest(p), onCaptureError);
  if (!captureProc) ws.error('no_backend', 'No capture backend available — install Wireshark (tshark).');

  startProcessPolling();

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
      captureProc?.kill();
      tracker.clear();
      resetLog();
      ws.reset();
      iface = msg.iface;
      backendInfo.iface = iface;
      localIps = getLocalIps();
      refreshHome();
      captureProc = startCapture(backend, iface, localIps, (p) => tracker.ingest(p), onCaptureError);
      ws.broadcastInit();
    }
  };

  if (process.env.SERVE_DIST) {
    serveDist();
    // Local open works on any bind; the token rides the URL so the page can
    // hand it to the WS (only set for non-local binds).
    openBrowser(`http://localhost:${HTTP_PORT}${TOKEN ? `/?token=${TOKEN}` : ''}`);
  }

  console.log(
    `netport-radar live · backend=${backend} dpi=${backendInfo.dpiMode} iface=${iface} ws=${WS_PORT}`,
  );

  const shutdown = () => {
    captureProc?.kill();
    tracker.stop();
    stopProcessPolling();
    ws.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
