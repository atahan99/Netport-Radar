// server/capture.ts
// netport-radar capture backend. Priority: tshark (full DPI) → tcpdump
// (port-based) → node-pcap (Windows last resort, stub). DPI runs locally —
// nothing leaves the machine.

import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import type { Readable } from 'stream';
import * as os from 'os';
import * as dns from 'dns/promises';
import geoip from 'geoip-lite';
import { open as openMmdb, type Reader, type CityResponse, type AsnResponse } from 'maxmind';
import { LRUCache } from 'lru-cache';
import type { DetectedProtocol, HomeAirport } from '../src/types';
import { WS_PORT } from './config';

// Our own WS feed must never be captured as traffic.
const CAPTURE_FILTER = `not port ${WS_PORT}`;

export type CaptureBackend = 'tshark' | 'tcpdump' | 'pcap';

export interface RawPacket {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: string; // raw transport: TCP/UDP/ICMP
  detectedProtocol: DetectedProtocol;
  length: number;
  direction: 'outbound' | 'inbound';
  isIPv6: boolean;
  host?: string; // SNI / HTTP Host / DNS query name when visible (tshark)
  tcpFin?: boolean;
  tcpRst?: boolean;
}

// ── tshark path: prefer PATH (Homebrew), fall back to the Wireshark.app binary ──
const APP_TSHARK = '/Applications/Wireshark.app/Contents/MacOS/tshark';

export function tsharkPath(): string {
  try {
    execSync('command -v tshark', { stdio: 'ignore' });
    return 'tshark';
  } catch {
    /* not on PATH */
  }
  if (existsSync(APP_TSHARK)) return APP_TSHARK;
  return 'tshark';
}

// dumpcap ships next to tshark (Wireshark's capture-only helper, no dissectors).
export function dumpcapPath(): string {
  const t = tsharkPath();
  return t === 'tshark' ? 'dumpcap' : join(dirname(t), 'dumpcap');
}

// ── Backend auto-detect ────────────────────────────────────────────────────
export function detectBackend(): CaptureBackend {
  // Force a specific backend (testing the tcpdump path on a tshark machine,
  // and the Phase 9 fixtures).
  const override = process.env.NETPORT_BACKEND;
  if (override === 'tshark' || override === 'tcpdump' || override === 'pcap') return override;
  try {
    execSync(`"${tsharkPath()}" --version`, { stdio: 'ignore' });
    return 'tshark';
  } catch {
    /* no tshark */
  }
  if (os.platform() !== 'win32') {
    try {
      execSync('tcpdump --version', { stdio: 'ignore' });
      return 'tcpdump';
    } catch {
      /* no tcpdump */
    }
  }
  return 'pcap';
}

// ── tshark — full DPI via the dissector stack ──────────────────────────────
// Tab-separated fields (-T fields) stream one line per packet — robust + fast.
const TSHARK_FIELDS = [
  'ip.src',
  'ip.dst',
  'ipv6.src',
  'ipv6.dst',
  'tcp.srcport',
  'tcp.dstport',
  'udp.srcport',
  'udp.dstport',
  'frame.protocols',
  'frame.len',
  'tls.handshake.extensions_server_name',
  'dns.qry.name',
  'http.host',
  'tcp.flags.fin',
  'tcp.flags.reset',
];

const TSHARK_OUTPUT_ARGS = [
  '-l',
  '-n',
  '-T', 'fields',
  '-E', 'separator=\t',
  '-E', 'occurrence=f',
  ...TSHARK_FIELDS.flatMap((f) => ['-e', f]),
];
const TSHARK_ERR = /error|permission|denied|couldn't|failed/i;
const TCPDUMP_ERR = /error|permission|denied/i;

// Turn a text stream (decoder stdout) into RawPackets, one per line.
function readLines(
  stream: Readable,
  parse: (line: string, localIps: Set<string>) => RawPacket | null,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
): void {
  stream.setEncoding('utf8'); // decode across chunk boundaries (multibyte SNI)
  let buffer = '';
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const pkt = parse(line, localIps);
      if (pkt) onPacket(pkt);
    }
  });
}

function watchStderr(proc: ChildProcess, errRe: RegExp, onError: (msg: string) => void): void {
  proc.stderr!.on('data', (d: Buffer) => {
    const msg = d.toString();
    if (errRe.test(msg)) onError(msg.trim());
  });
  proc.on('error', (e) => onError(String(e)));
}

// Spawn a capture/decoder process whose stdout is one packet per line. When
// `input` is given it is piped to stdin (pcap stream from the root broker).
function spawnLineReader(
  cmd: string,
  args: string[],
  parse: (line: string, localIps: Set<string>) => RawPacket | null,
  errRe: RegExp,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
  onError: (msg: string) => void,
  input?: Readable,
): ChildProcess {
  const proc = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  if (input && proc.stdin) {
    proc.stdin.on('error', () => {}); // decoder exited first (EPIPE) — its exit is reported
    input.on('error', () => proc.kill());
    input.pipe(proc.stdin);
  }
  readLines(proc.stdout!, parse, localIps, onPacket);
  watchStderr(proc, errRe, onError);
  return proc;
}

// Inline mode: tshark captures and dissects in one process.
export function startTshark(
  iface: string,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
  onError: (msg: string) => void,
): ChildProcess {
  const args = ['-i', iface, '--no-promiscuous-mode', '-f', CAPTURE_FILTER, ...TSHARK_OUTPUT_ARGS];
  return spawnLineReader(tsharkPath(), args, parseTsharkLine, TSHARK_ERR, localIps, onPacket, onError);
}

export function parseTsharkLine(line: string, localIps: Set<string>): RawPacket | null {
  if (!line) return null;
  const f = line.split('\t');
  const at = (i: number) => f[i] ?? '';
  const srcIp = at(0) || at(2);
  const dstIp = at(1) || at(3);
  if (!srcIp || !dstIp) return null;

  const srcPort = Number(at(4) || at(6) || 0);
  const dstPort = Number(at(5) || at(7) || 0);
  const frameProtos = at(8).toLowerCase();
  const length = Number(at(9) || 0);
  const sni = at(10);
  const dnsQuery = at(11);
  const httpHost = at(12);

  const { detectedProtocol, protocol } = detectFromFrameProtos(frameProtos, dstPort);

  return {
    srcIp,
    dstIp,
    srcPort,
    dstPort,
    protocol,
    detectedProtocol,
    length,
    direction: localIps.has(srcIp) ? 'outbound' : 'inbound',
    isIPv6: srcIp.includes(':'),
    host: sni || httpHost || dnsQuery || undefined,
    tcpFin: at(13) === '1',
    tcpRst: at(14) === '1',
  };
}

export function detectFromFrameProtos(
  frameProtos: string,
  dstPort: number,
): { detectedProtocol: DetectedProtocol; protocol: string } {
  let detectedProtocol: DetectedProtocol = 'Unknown';

  if (frameProtos.includes('wg') || frameProtos.includes('wireguard')) detectedProtocol = 'WireGuard';
  else if (frameProtos.includes('openvpn')) detectedProtocol = 'OpenVPN';
  else if (frameProtos.includes('isakmp')) detectedProtocol = 'IKEv2';
  else if (frameProtos.includes('esp')) detectedProtocol = 'IPSec-ESP';
  else if (frameProtos.includes('l2tp')) detectedProtocol = 'L2TP';
  else if (frameProtos.includes('pptp')) detectedProtocol = 'PPTP';
  else if (frameProtos.includes('gre')) detectedProtocol = 'GRE';
  else if (frameProtos.includes('vxlan')) detectedProtocol = 'VXLAN';
  else if (frameProtos.includes('geneve')) detectedProtocol = 'Geneve';
  else if (frameProtos.includes('quic')) detectedProtocol = frameProtos.includes('dns') ? 'DoQ' : 'QUIC';
  else if (
    frameProtos.includes('dns') &&
    (frameProtos.includes('tls') || frameProtos.includes('http2') || frameProtos.includes('http3'))
  )
    detectedProtocol = 'DoH';
  else if (frameProtos.includes('dns') && frameProtos.includes('tls') && dstPort === 853) detectedProtocol = 'DoT';
  else if (frameProtos.includes('mdns')) detectedProtocol = 'mDNS';
  else if (frameProtos.includes('llmnr')) detectedProtocol = 'LLMNR';
  else if (frameProtos.includes('dns')) detectedProtocol = 'DNS';
  else if (frameProtos.includes('ssh')) detectedProtocol = 'SSH';
  else if (frameProtos.includes('rtmp')) detectedProtocol = 'RTMP';
  else if (frameProtos.includes('rtsp')) detectedProtocol = 'RTSP';
  else if (frameProtos.includes('srt')) detectedProtocol = 'SRT';
  else if (frameProtos.includes('rtp')) detectedProtocol = 'RTP';
  else if (frameProtos.includes('stun') || frameProtos.includes('dtls')) detectedProtocol = 'WebRTC';
  else if (frameProtos.includes('xmpp')) detectedProtocol = 'XMPP';
  else if (frameProtos.includes('mqtt')) detectedProtocol = 'MQTT';
  else if (frameProtos.includes('http2') || frameProtos.includes('http3')) detectedProtocol = 'HTTPS';
  else if (frameProtos.includes('http')) detectedProtocol = 'HTTP';
  else if (frameProtos.includes('tls')) detectedProtocol = 'HTTPS';
  else if (frameProtos.includes('icmpv6')) detectedProtocol = 'ICMPv6';
  else if (frameProtos.includes('icmp')) detectedProtocol = 'ICMP';
  else if (frameProtos.includes('tcp')) detectedProtocol = 'TCP';
  else if (frameProtos.includes('udp')) detectedProtocol = 'UDP';

  let protocol = 'TCP';
  if (frameProtos.includes('udp')) protocol = 'UDP';
  if (frameProtos.includes('icmp')) protocol = 'ICMP';
  return { detectedProtocol, protocol };
}

// ── tcpdump — port-based fallback (no DPI) ─────────────────────────────────
export function startTcpdump(
  iface: string,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
  onError: (msg: string) => void,
): ChildProcess {
  // No -q: we need the "Flags [F./R.]" field to detect connection close
  // (descent/landed); without it closes only fire via the 120s stale timer.
  const args = ['-i', iface, '-l', '-n', '-t', '-U', CAPTURE_FILTER];
  return spawnLineReader('tcpdump', args, parseTcpdumpLine, TCPDUMP_ERR, localIps, onPacket, onError);
}

// "1.2.3.4.443" → {ip:1.2.3.4, port:443}; "2001:db8::1.443" → {ip:2001:db8::1,
// port:443}. Only called for TCP/UDP — ICMP endpoints have no trailing port and
// would otherwise mis-split a v4 IP's last octet (1.2.3.4 → "1.2.3":4).
function splitEndpoint(tok: string): { ip: string; port: number } {
  const m = tok.match(/^(.*)\.(\d+)$/);
  return m ? { ip: m[1], port: Number(m[2]) } : { ip: tok, port: 0 };
}

export function parseTcpdumpLine(line: string, localIps: Set<string>): RawPacket | null {
  // "IP[6] <src[.port]> > <dst[.port]>: <rest>" — the prefix is stable across
  // -q/non-q and protocol; the rest tells us protocol + flags + length.
  const m = line.match(/^IP(6)?\s+(\S+)\s+>\s+(\S+):\s+(.*)$/);
  if (!m) return null;
  const [, v6, srcTok, dstTok, rest] = m;

  const flags = rest.match(/^Flags \[([^\]]*)\]/);
  const protocol = flags ? 'TCP' : /^ICMP6?/i.test(rest) ? 'ICMP' : 'UDP';
  const hasPort = protocol !== 'ICMP';
  const src = hasPort ? splitEndpoint(srcTok) : { ip: srcTok, port: 0 };
  const dst = hasPort ? splitEndpoint(dstTok) : { ip: dstTok, port: 0 };

  // Prefer the well-known side: outbound uses dstPort, but an inbound packet's
  // service port is srcPort — try both before falling back to generic TCP/UDP.
  let detected = portBasedDetect(protocol, dst.port);
  if ((detected === 'TCP' || detected === 'UDP') && src.port) {
    const alt = portBasedDetect(protocol, src.port);
    if (alt !== 'TCP' && alt !== 'UDP') detected = alt;
  }

  const lenMatch = rest.match(/length (\d+)/);
  return {
    srcIp: src.ip,
    dstIp: dst.ip,
    srcPort: src.port,
    dstPort: dst.port,
    protocol,
    detectedProtocol: detected,
    length: lenMatch ? Number(lenMatch[1]) : 0,
    direction: localIps.has(src.ip) ? 'outbound' : 'inbound',
    isIPv6: !!v6 || src.ip.includes(':'),
    tcpFin: flags ? flags[1].includes('F') : false,
    tcpRst: flags ? flags[1].includes('R') : false,
  };
}

export function portBasedDetect(protocol: string, port: number): DetectedProtocol {
  if (port === 53) return 'DNS';
  if (port === 5353) return 'mDNS';
  if (port === 853) return protocol === 'UDP' ? 'DoQ' : 'DoT';
  if (port === 51820 || port === 51821) return 'WireGuard';
  if (port === 1194) return 'OpenVPN';
  if (port === 500 || port === 4500) return 'IKEv2';
  if (port === 1701) return 'L2TP';
  if (port === 1723) return 'PPTP';
  if (port === 4789) return 'VXLAN';
  if (port === 22) return 'SSH';
  if (port === 1935) return 'RTMP';
  if (port === 443 && protocol === 'UDP') return 'QUIC';
  if (port === 443) return 'HTTPS';
  if (port === 80) return 'HTTP';
  if (protocol === 'ICMP') return 'ICMP';
  if (protocol === 'UDP') return 'UDP';
  return 'TCP';
}

export function startCapture(
  backend: CaptureBackend,
  iface: string,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
  onError: (msg: string) => void,
): ChildProcess | null {
  if (backend === 'tshark') return startTshark(iface, localIps, onPacket, onError);
  if (backend === 'tcpdump') return startTcpdump(iface, localIps, onPacket, onError);
  onError('node-pcap backend not implemented — install Wireshark (tshark) or use tcpdump');
  return null;
}

// ── GeoIP + reverse DNS ────────────────────────────────────────────────────
const dnsCache = new LRUCache<string, string>({ max: 2000, ttl: 1000 * 60 * 30 });

export async function resolveHostname(ip: string): Promise<string> {
  const cached = dnsCache.get(ip);
  if (cached) return cached;
  try {
    const names = await dns.reverse(ip);
    const result = names[0] ?? ip;
    dnsCache.set(ip, result);
    return result;
  } catch {
    dnsCache.set(ip, ip);
    return ip;
  }
}

export type GeoConfidence = 'city' | 'country';

export interface GeoInfo {
  lat: number;
  lng: number;
  country: string;
  city: string;
  org: string;
  asn?: string;
  confidence: GeoConfidence;
}

// Optional, off by default: point NETPORT_MMDB_CITY / NETPORT_MMDB_ASN at
// MaxMind GeoLite2 .mmdb files (free account, downloaded by the user — we bundle
// nothing) for city-accurate destinations + real org/ASN. Without them we use
// the bundled geoip-lite (country-accurate, no ASN). Lazy-loaded once.
let cityReader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;
// Async-load the optional readers at module init — done long before the 2s DNS
// hold lets any flight need geo, so geoLookup stays synchronous.
void (async () => {
  const { NETPORT_MMDB_CITY, NETPORT_MMDB_ASN } = process.env;
  if (NETPORT_MMDB_CITY) {
    try {
      cityReader = await openMmdb<CityResponse>(NETPORT_MMDB_CITY);
      console.log(`[geo] using MaxMind city DB: ${NETPORT_MMDB_CITY}`);
    } catch (e) {
      console.warn('[geo] could not open NETPORT_MMDB_CITY — falling back to geoip-lite:', e);
    }
  }
  if (NETPORT_MMDB_ASN) {
    try {
      asnReader = await openMmdb<AsnResponse>(NETPORT_MMDB_ASN);
    } catch (e) {
      console.warn('[geo] could not open NETPORT_MMDB_ASN:', e);
    }
  }
})();

export function geoLookup(ip: string): GeoInfo | null {
  if (cityReader) {
    const c = cityReader.get(ip);
    if (c?.location) {
      const asnNum = asnReader?.get(ip)?.autonomous_system_number;
      const city = c.city?.names?.en ?? '';
      return {
        lat: c.location.latitude ?? 0,
        lng: c.location.longitude ?? 0,
        country: c.country?.iso_code ?? c.registered_country?.iso_code ?? 'XX',
        city,
        org: asnReader?.get(ip)?.autonomous_system_organization ?? 'Unknown',
        asn: asnNum ? `AS${asnNum}` : undefined,
        confidence: city ? 'city' : 'country',
      };
    }
    // mmdb miss → fall through to geoip-lite below
  }
  const geo = geoip.lookup(ip);
  if (!geo) return null;
  const city = geo.city ?? '';
  return {
    lat: geo.ll?.[0] ?? 0,
    lng: geo.ll?.[1] ?? 0,
    country: geo.country ?? 'XX',
    city,
    org: 'Unknown',
    confidence: city ? 'city' : 'country',
  };
}

// ── Home airport detection (cluster source IPs) ────────────────────────────
export function detectHomeAirports(
  sourceIps: string[],
  lookup: (ip: string) => GeoInfo | null = geoLookup,
): HomeAirport[] {
  const valid = sourceIps
    .map((ip) => {
      const geo = lookup(ip);
      return geo ? { ip, ...geo } : null;
    })
    .filter((x): x is { ip: string } & GeoInfo => x !== null);
  if (valid.length === 0) return [];

  const clusters: (typeof valid)[] = [];
  for (const point of valid) {
    const hit = clusters.find(
      (c) => haversineKm(point.lat, point.lng, c[0].lat, c[0].lng) < 100,
    );
    if (hit) hit.push(point);
    else clusters.push([point]);
  }
  // Biggest cluster (most distinct source IPs) = primary; others = VPN exits.
  clusters.sort((a, b) => b.length - a.length);

  return clusters.slice(0, 3).map((cluster, i) => {
    const rep = cluster[0];
    const place = rep.city ? `${rep.city}, ${rep.country}` : rep.country;
    return {
      id: i === 0 ? 'primary' : `vpn-${i}`,
      label: i === 0 ? place : `${place} (VPN)`,
      lat: rep.lat,
      lng: rep.lng,
      ip: rep.ip,
      isVpn: i > 0,
    };
  });
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Privilege-split capture ────────────────────────────────────────────────
// Brokered mode keeps packet parsing out of root. The root broker only opens the
// capture device; whatever parses hostile traffic runs as the invoking user:
//   tshark backend:  root dumpcap writes raw pcap → the parent runs tshark on it
//   tcpdump backend: tcpdump -Z <user> opens BPF as root, then drops to the user
//                    before dissecting (macOS libpcap can't read pcap from a
//                    pipe, so the parent just parses its text output).

export function startRawCapture(
  backend: CaptureBackend,
  iface: string,
  dropUser: string,
  onError: (msg: string) => void,
): ChildProcess | null {
  let proc: ChildProcess;
  if (backend === 'tshark') {
    proc = spawn(dumpcapPath(), ['-i', iface, '-p', '-f', CAPTURE_FILTER, '-F', 'pcap', '-q', '-w', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    watchStderr(proc, TSHARK_ERR, onError);
  } else if (backend === 'tcpdump') {
    proc = spawn('tcpdump', ['-i', iface, '-Z', dropUser, '-l', '-n', '-t', '-U', CAPTURE_FILTER], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    watchStderr(proc, TCPDUMP_ERR, onError);
  } else {
    onError('node-pcap backend not implemented — install Wireshark (tshark) or use tcpdump');
    return null;
  }
  return proc;
}

export interface Decoder {
  stop(): void;
}

export function startDecoder(
  backend: CaptureBackend,
  input: Readable & { destroy(): void },
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
  onError: (msg: string) => void,
): Decoder {
  if (backend === 'tcpdump') {
    readLines(input, parseTcpdumpLine, localIps, onPacket); // already text
    return { stop: () => input.destroy() };
  }
  // -i - (not -r -): tshark refuses to read a socket as a file; as a live
  // "interface" it accepts any pcap stream on stdin.
  const args = ['-i', '-', ...TSHARK_OUTPUT_ARGS];
  const proc = spawnLineReader(tsharkPath(), args, parseTsharkLine, TSHARK_ERR, localIps, onPacket, onError, input);
  return {
    stop: () => {
      input.destroy();
      proc.kill();
    },
  };
}
