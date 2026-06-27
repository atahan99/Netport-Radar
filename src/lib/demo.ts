// src/lib/demo.ts
// useDemoFlights() — simulates network flights for Phase 1 (no backend).
// Two home airports, all 10 aircraft types, ~80% outbound / ~20% inbound,
// rAF-driven arcProgress + phase transitions. Hidden keys: R (reconnect
// overlay), B (burst ~200 flights to exercise the 150-cap counter).

import { useEffect } from 'react';
import type {
  AircraftType,
  DetectedProtocol,
  Flight,
  HomeAirport,
} from '@/types';
import { useFlightsStore } from '@/store/flights';
import { useConnectionStore } from '@/store/connection';
import { liveryColor, normalizeProcess } from './livery';

export const DEMO_HOME_AIRPORTS: HomeAirport[] = [
  { id: 'primary', label: 'Istanbul, TR', lat: 41.01, lng: 28.97, ip: '78.162.41.9', isVpn: false },
  { id: 'vpn-1', label: 'Zürich, CH (VPN)', lat: 47.37, lng: 8.54, ip: '185.220.70.2', isVpn: true },
];

interface Dest {
  city: string;
  country: string;
  flag: string;
  lat: number;
  lng: number;
}

const DESTINATIONS: Dest[] = [
  { city: 'San Francisco', country: 'US', flag: '🇺🇸', lat: 37.77, lng: -122.41 },
  { city: 'New York', country: 'US', flag: '🇺🇸', lat: 40.71, lng: -74.0 },
  { city: 'London', country: 'GB', flag: '🇬🇧', lat: 51.5, lng: -0.12 },
  { city: 'Amsterdam', country: 'NL', flag: '🇳🇱', lat: 52.37, lng: 4.89 },
  { city: 'Frankfurt', country: 'DE', flag: '🇩🇪', lat: 50.11, lng: 8.68 },
  { city: 'Stockholm', country: 'SE', flag: '🇸🇪', lat: 59.33, lng: 18.06 },
  { city: 'Paris', country: 'FR', flag: '🇫🇷', lat: 48.85, lng: 2.35 },
  { city: 'Tokyo', country: 'JP', flag: '🇯🇵', lat: 35.68, lng: 139.69 },
  { city: 'Singapore', country: 'SG', flag: '🇸🇬', lat: 1.35, lng: 103.81 },
  { city: 'Sydney', country: 'AU', flag: '🇦🇺', lat: -33.86, lng: 151.2 },
  { city: 'São Paulo', country: 'BR', flag: '🇧🇷', lat: -23.55, lng: -46.63 },
  { city: 'Toronto', country: 'CA', flag: '🇨🇦', lat: 43.65, lng: -79.38 },
  { city: 'Mumbai', country: 'IN', flag: '🇮🇳', lat: 19.07, lng: 72.87 },
  { city: 'Seoul', country: 'KR', flag: '🇰🇷', lat: 37.56, lng: 126.97 },
  { city: 'Johannesburg', country: 'ZA', flag: '🇿🇦', lat: -26.2, lng: 28.04 },
];

interface ProcDef {
  process: string;
  proto: DetectedProtocol;
  port: number;
  aircraft: AircraftType;
  host: string;
  org: string;
  asn: string;
}

// Covers all 10 aircraft types (incl. HTTP→narrowbody, ICMP→ambulance, SSH→stealth).
const PROCESS_POOL: ProcDef[] = [
  { process: 'chrome', proto: 'HTTPS', port: 443, aircraft: 'widebody', host: 'google.com', org: 'Alphabet Inc.', asn: 'AS15169' },
  { process: 'discord', proto: 'UDP', port: 443, aircraft: 'helicopter', host: 'discord.media', org: 'Discord Inc.', asn: 'AS49544' },
  { process: 'spotify', proto: 'HTTPS', port: 443, aircraft: 'satellite', host: 'audio-fa.spotifycdn.com', org: 'Spotify AB', asn: 'AS8403' },
  { process: 'steam', proto: 'TCP', port: 443, aircraft: 'cargo', host: 'steamcontent.com', org: 'Valve Corp', asn: 'AS32590' },
  { process: 'firefox', proto: 'HTTPS', port: 443, aircraft: 'widebody', host: 'mozilla.net', org: 'Mozilla', asn: 'AS36856' },
  { process: 'code', proto: 'HTTPS', port: 443, aircraft: 'widebody', host: 'update.code.visualstudio.com', org: 'Microsoft', asn: 'AS8075' },
  { process: 'brave', proto: 'QUIC', port: 443, aircraft: 'helicopter', host: 'brave.com', org: 'Cloudflare', asn: 'AS13335' },
  { process: 'signal', proto: 'HTTPS', port: 443, aircraft: 'widebody', host: 'chat.signal.org', org: 'Amazon AWS', asn: 'AS16509' },
  { process: 'telegram', proto: 'HTTPS', port: 443, aircraft: 'widebody', host: 'telegram.org', org: 'Telegram', asn: 'AS62041' },
  { process: 'obs', proto: 'RTMP', port: 1935, aircraft: 'broadcast', host: 'live.twitch.tv', org: 'Twitch', asn: 'AS46489' },
  { process: 'protonvpn', proto: 'WireGuard', port: 51820, aircraft: 'privatejet', host: 'proton.me', org: 'Proton AG', asn: 'AS62371' },
  { process: 'chrome', proto: 'DNS', port: 53, aircraft: 'drone', host: 'dns.google', org: 'Alphabet Inc.', asn: 'AS15169' },
  { process: 'svchost.exe', proto: 'HTTPS', port: 443, aircraft: 'widebody', host: 'windowsupdate.com', org: 'Microsoft', asn: 'AS8075' },
  { process: 'spotify', proto: 'HTTP', port: 80, aircraft: 'narrowbody', host: 'i.scdn.co', org: 'Spotify AB', asn: 'AS8403' },
  { process: 'ping', proto: 'ICMP', port: 0, aircraft: 'ambulance', host: '1.1.1.1', org: 'Cloudflare', asn: 'AS13335' },
  { process: 'ssh', proto: 'SSH', port: 22, aircraft: 'stealth', host: 'bastion.example.net', org: 'DigitalOcean', asn: 'AS14061' },
];

interface SimFlight extends Flight {
  spawnAt: number; // performance.now() at creation (may be in the past)
  taxiMs: number;
  cruiseMs: number;
  holdMs: number;
  descentMs: number;
  landedMs: number;
  rate: number; // bytes/sec while cruising
  done: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const hex4 = () =>
  Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
const octet = () => 1 + Math.floor(Math.random() * 222);
const randIp = () => `${octet()}.${octet()}.${octet()}.${octet()}`;

function makeFlight(now: number, inbound: boolean): SimFlight {
  const proc = pick(PROCESS_POOL);
  const dest = pick(DESTINATIONS);
  const home = Math.random() < 0.3 ? DEMO_HOME_AIRPORTS[1] : DEMO_HOME_AIRPORTS[0];
  const willHold = Math.random() < 0.5;
  const process = normalizeProcess(proc.process);
  const remoteIp = randIp();
  const ephemeral = 1024 + Math.floor(Math.random() * 64000);

  const protocol =
    proc.proto === 'ICMP'
      ? 'ICMP'
      : proc.proto === 'UDP' || proc.proto === 'QUIC' || proc.proto === 'DNS'
        ? 'UDP'
        : 'TCP';

  return {
    id: `${proc.process.slice(0, 3).toUpperCase()}-${hex4()}`,
    process,
    processRaw: proc.process,
    pid: 1000 + Math.floor(Math.random() * 60000),
    protocol,
    detectedProtocol: proc.proto,
    port: proc.port,
    // Local machine is always srcIp (matches live capture) — the flight card's
    // "YOUR PC" must never show a remote IP. direction still drives the boards.
    srcIp: home.ip,
    dstIp: remoteIp,
    srcPort: inbound ? proc.port : ephemeral,
    dstPort: inbound ? ephemeral : proc.port,
    isIPv6: false,
    homeAirportId: home.id,
    dstLat: dest.lat,
    dstLng: dest.lng,
    country: dest.country,
    countryFlag: dest.flag,
    city: dest.city,
    org: proc.org,
    asn: proc.asn,
    hostname: proc.host,
    sni: undefined,
    hostnameResolved: false,
    aircraftType: proc.aircraft,
    phase: 'taxi',
    liveryColor: liveryColor(proc.process),
    bytesTotal: 0,
    bytesTx: 0,
    bytesRx: 0,
    bytesPerSec: 0,
    packetsTotal: 0,
    durationMs: 0,
    arcProgress: 0,
    direction: inbound ? 'inbound' : 'outbound',
    isLan: false,
    startedAt: Date.now(),
    // sim-only
    spawnAt: now,
    taxiMs: rand(500, 2000),
    cruiseMs: rand(8000, 30000),
    holdMs: willHold ? rand(3000, 10000) : 0,
    descentMs: 2000,
    landedMs: 1400,
    rate: rand(4000, 600000),
    done: false,
  };
}

function advance(sf: SimFlight, now: number): void {
  const t = now - sf.spawnAt;
  const taxiEnd = sf.taxiMs;
  const cruiseEnd = taxiEnd + sf.cruiseMs;
  const holdEnd = cruiseEnd + sf.holdMs;
  const descEnd = holdEnd + sf.descentMs;
  const landEnd = descEnd + sf.landedMs;

  if (t < taxiEnd) {
    sf.phase = 'taxi';
    sf.arcProgress = 0;
  } else if (t < cruiseEnd) {
    sf.phase = 'cruise';
    sf.arcProgress = 0.8 * ((t - taxiEnd) / sf.cruiseMs);
  } else if (t < holdEnd) {
    sf.phase = 'hold';
    sf.arcProgress = 0.8;
  } else if (t < descEnd) {
    sf.phase = 'descent';
    sf.arcProgress = 0.8 + 0.2 * ((t - holdEnd) / sf.descentMs);
  } else if (t < landEnd) {
    sf.phase = 'landed';
    sf.arcProgress = 1;
  } else {
    sf.phase = 'landed';
    sf.arcProgress = 1;
    sf.done = true;
  }

  sf.hostnameResolved = t >= taxiEnd;
  sf.durationMs = Math.max(0, t - taxiEnd);
  const activeMs = Math.max(0, Math.min(t, descEnd) - taxiEnd);
  sf.bytesTotal = Math.round((sf.rate * activeMs) / 1000);
  sf.bytesTx = Math.round(sf.bytesTotal * 0.15);
  sf.bytesRx = sf.bytesTotal - sf.bytesTx;
  sf.bytesPerSec =
    sf.phase === 'cruise' || sf.phase === 'descent'
      ? Math.round(sf.rate)
      : sf.phase === 'hold'
        ? Math.round(sf.rate * 0.1)
        : 0;
  sf.packetsTotal = Math.round(sf.bytesTotal / 1400);
}

export function useDemoFlights(enabled = true): void {
  const setHomeAirports = useFlightsStore((s) => s.setHomeAirports);
  const setFlights = useFlightsStore((s) => s.setFlights);

  useEffect(() => {
    if (!enabled) return;
    setHomeAirports(DEMO_HOME_AIRPORTS);

    const flights: SimFlight[] = [];
    const t0 = performance.now();
    // Seed 10 flights already mid-flight so the map is populated on load.
    for (let i = 0; i < 10; i++) {
      flights.push(makeFlight(t0 - rand(2000, 14000), Math.random() < 0.2));
    }

    let raf = 0;
    const loop = (now: number) => {
      for (const sf of flights) if (!sf.done) advance(sf, now);
      setFlights(flights.slice());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    let spawnTimer = 0;
    const scheduleSpawn = () => {
      spawnTimer = window.setTimeout(() => {
        // ~15% of connections are short-lived (<2s) — logged, never rendered.
        if (Math.random() < 0.15) {
          console.log('[demo] short-lived flight skipped from rendering (log only)');
        } else {
          flights.push(makeFlight(performance.now(), Math.random() < 0.2));
        }
        scheduleSpawn();
      }, rand(1000, 4000));
    };
    scheduleSpawn();

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'r' || e.key === 'R') {
        const { reconnecting, setReconnecting } = useConnectionStore.getState();
        setReconnecting(!reconnecting);
      } else if (e.key === 'b' || e.key === 'B') {
        const base = performance.now();
        for (let i = 0; i < 200; i++) {
          flights.push(makeFlight(base - rand(0, 9000), Math.random() < 0.3));
        }
        console.log('[demo] burst: +200 flights');
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(spawnTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, setHomeAirports, setFlights]);
}
