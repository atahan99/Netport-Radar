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
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { BackendInfo, HomeAirport } from '../src/types';
import { detectBackend, geoLookup, startCapture, type CaptureBackend } from './capture';
import { FlowTracker } from './flow-tracker';
import { WsHub } from './ws';

const WS_PORT = 8090;
const HTTP_PORT = 8080;

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

interface IpApiResp {
  status: string;
  country: string;
  countryCode: string;
  city: string;
  lat: number;
  lon: number;
  query: string;
}

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
  // ip-api.com geolocates your public IP city-accurately in one call.
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
  // Fallback: public IP + local geoip-lite (country-accurate).
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
    .listen(HTTP_PORT, () => console.log(`[serve] dist on http://localhost:${HTTP_PORT}`));
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

function main(): void {
  const backend: CaptureBackend = detectBackend();
  const iface = process.env.NETPORT_IFACE ?? getDefaultInterface();
  const localIps = getLocalIps();
  const backendInfo: BackendInfo = {
    capture: backend,
    dpiMode: backend === 'tshark' ? 'full' : 'port-based',
    iface,
  };
  let homeAirports: HomeAirport[] = [];

  const ws = new WsHub(WS_PORT, () => ({ homeAirports, backend: backendInfo }));
  const tracker = new FlowTracker({
    getHomeAirports: () => homeAirports,
    onEvent: (e) => ws.enqueue(e),
    onSourceIp: () => {},
  });

  void resolvePrimaryHome().then((home) => {
    homeAirports = [home];
    ws.homeUpdate(homeAirports);
    console.log(`[home] ${home.label} (${home.lat.toFixed(2)}, ${home.lng.toFixed(2)})`);
  });

  const proc = startCapture(
    backend,
    iface,
    localIps,
    (p) => tracker.ingest(p),
    (msg) => {
      console.error('[capture]', msg);
      if (/permission|denied|bpf|root|operation not permitted/i.test(msg)) {
        ws.error('capture_permission', 'No capture permission — run with sudo (see README).');
      } else {
        ws.error('capture_error', msg.slice(0, 200));
      }
    },
  );
  if (!proc) ws.error('no_backend', 'No capture backend available — install Wireshark (tshark).');

  if (process.env.SERVE_DIST) {
    serveDist();
    openBrowser(`http://localhost:${HTTP_PORT}`);
  }

  console.log(
    `netport-radar live · backend=${backend} dpi=${backendInfo.dpiMode} iface=${iface} ws=${WS_PORT}`,
  );

  const shutdown = () => {
    proc?.kill();
    tracker.stop();
    ws.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
