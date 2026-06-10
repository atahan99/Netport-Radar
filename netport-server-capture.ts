// server/capture.ts
// netport-radar capture backend
// Supports three capture methods in priority order:
//   1. tshark (Wireshark CLI) — preferred, full DPI, all platforms
//   2. tcpdump — macOS/Linux fallback, no DPI
//   3. node-pcap — Windows fallback if tshark unavailable
//
// tshark is STRONGLY preferred. Install Wireshark on any platform
// and tshark comes with it. DPI runs locally — no data leaves the machine.

import { spawn, execSync } from 'child_process';
import * as os from 'os';
import * as dns from 'dns/promises';
import geoip from 'geoip-lite';                     // npm i geoip-lite
import { LRUCache } from 'lru-cache';               // npm i lru-cache

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type DetectedProtocol =
  | 'HTTPS' | 'HTTP' | 'TCP' | 'UDP' | 'ICMP' | 'ICMPv6'
  // DNS family
  | 'DNS' | 'mDNS' | 'LLMNR'
  | 'DoT'           // DNS-over-TLS  (TCP 853)
  | 'DoH'           // DNS-over-HTTPS (tshark dissects this natively)
  | 'DoQ'           // DNS-over-QUIC
  // HTTP/3 + QUIC
  | 'QUIC'          // HTTP/3 or standalone QUIC
  // VPN / tunnel family
  | 'WireGuard'
  | 'OpenVPN'       // tshark sees this regardless of port
  | 'IKEv2'         // IPSec key exchange
  | 'IPSec-ESP'     // IPSec encapsulated payload
  | 'L2TP'
  | 'PPTP'
  | 'GRE'
  | 'VXLAN'
  | 'Geneve'        // modern overlay protocol
  // Privacy / tunnel
  | 'SSH'
  | 'Tor'
  // Streaming / media
  | 'RTMP' | 'RTP' | 'RTSP' | 'SRT' | 'WebRTC'
  // Gaming
  | 'Steam' | 'EAC' | 'BattleNet'
  // Messaging
  | 'XMPP' | 'MQTT'
  // Unknown
  | 'Unknown';

export interface RawPacket {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: string;          // raw transport: TCP/UDP/ICMP/etc.
  detectedProtocol: DetectedProtocol;
  length: number;            // bytes
  direction: 'outbound' | 'inbound';
  // tshark-only fields (undefined when using tcpdump/pcap fallback)
  tlsVersion?: string;       // e.g. "TLSv1.3"
  quicVersion?: string;
  wireguardMsgType?: string; // "handshake_initiation" etc.
  httpHost?: string;         // HTTP Host header if visible
  dnsQuery?: string;         // DNS query name if DNS
  processName?: string;      // enriched separately via process-names.ts
  pid?: number;
}

// ─────────────────────────────────────────────────────────────
// TSHARK — primary backend
// ─────────────────────────────────────────────────────────────

// tshark JSON fields we care about
// Run `tshark -G fields | grep <proto>` to explore available fields
const TSHARK_FIELDS = [
  'ip.src', 'ip.dst',
  'ipv6.src', 'ipv6.dst',
  'tcp.srcport', 'tcp.dstport',
  'udp.srcport', 'udp.dstport',
  'frame.protocols',        // full protocol stack e.g. "eth:ip:tcp:tls:http2"
  'frame.len',
  // TLS
  'tls.record.version',
  'tls.handshake.extensions_server_name',  // SNI — reveals hostname even over TLS
  // QUIC
  'quic.version',
  // WireGuard
  'wg.type',                // handshake_initiation, handshake_response, data
  // OpenVPN
  'openvpn.plen',           // presence = OpenVPN packet confirmed
  // IKEv2
  'isakmp.version',
  // DNS
  'dns.qry.name',
  'dns.flags.response',
  // HTTP (unencrypted)
  'http.host',
  'http.request.method',
  // SSH
  'ssh.protocol',
].join(' -e ');

export function startTshark(
  iface: string,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
) {
  // Capture filter: exclude our own WebSocket traffic on port 8090
  // -l: line buffered, -n: no name resolution (we do our own async),
  // -T json: structured output, -e: specific fields only (faster than full dissect)
  // --no-promiscuous-mode: we only need our own traffic
  const args = [
    '-i', iface,
    '-l',
    '-n',
    '-T', 'json',
    '--no-promiscuous-mode',
    '-f', 'not port 8090',       // exclude our own WebSocket
    ...TSHARK_FIELDS.split(' '),
  ];

  const proc = spawn('tshark', args);
  let buffer = '';

  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    // tshark -T json outputs a JSON array, one object per packet
    // Stream-parse: extract complete {...} objects as they arrive
    let start = buffer.indexOf('{');
    let depth = 0;
    let i = start;
    while (i < buffer.length) {
      if (buffer[i] === '{') depth++;
      if (buffer[i] === '}') depth--;
      if (depth === 0 && start >= 0) {
        const raw = buffer.slice(start, i + 1);
        buffer = buffer.slice(i + 1);
        i = 0;
        start = buffer.indexOf('{');
        try {
          const pkt = parseTsharkPacket(JSON.parse(raw), localIps);
          if (pkt) onPacket(pkt);
        } catch {}
        continue;
      }
      i++;
    }
  });

  proc.stderr.on('data', (d: Buffer) => {
    // tshark writes info to stderr — only log actual errors
    const msg = d.toString();
    if (msg.includes('ERROR') || msg.includes('error')) console.error('[tshark]', msg);
  });

  return proc;
}

function parseTsharkPacket(
  json: Record<string, unknown>,
  localIps: Set<string>,
): RawPacket | null {
  const layers = (json['_source'] as Record<string, unknown>)?.['layers'] as Record<string, unknown>;
  if (!layers) return null;

  const srcIp = (layers['ip.src'] ?? layers['ipv6.src'] ?? '') as string;
  const dstIp = (layers['ip.dst'] ?? layers['ipv6.dst'] ?? '') as string;
  if (!srcIp || !dstIp) return null;

  const srcPort = Number(layers['tcp.srcport'] ?? layers['udp.srcport'] ?? 0);
  const dstPort = Number(layers['tcp.dstport'] ?? layers['udp.dstport'] ?? 0);
  const frameProtos = ((layers['frame.protocols'] ?? '') as string).toLowerCase();
  const length = Number(layers['frame.len'] ?? 0);

  const direction: 'outbound' | 'inbound' =
    localIps.has(srcIp) ? 'outbound' : 'inbound';

  // ── Protocol detection via tshark dissector stack ────────
  // frameProtos is the full stack e.g. "eth:ethertype:ip:tcp:tls:http2"
  // Order matters — check most specific first

  let detectedProtocol: DetectedProtocol = 'Unknown';

  // WireGuard — tshark has a full dissector
  if (frameProtos.includes('wg') || frameProtos.includes('wireguard')) {
    detectedProtocol = 'WireGuard';
  }
  // OpenVPN — tshark dissects this regardless of port (TCP 443 stealth included)
  else if (frameProtos.includes('openvpn')) {
    detectedProtocol = 'OpenVPN';
  }
  // IKEv2 / IPSec
  else if (frameProtos.includes('isakmp')) {
    detectedProtocol = 'IKEv2';
  }
  else if (frameProtos.includes('esp')) {
    detectedProtocol = 'IPSec-ESP';
  }
  else if (frameProtos.includes('l2tp')) {
    detectedProtocol = 'L2TP';
  }
  else if (frameProtos.includes('pptp')) {
    detectedProtocol = 'PPTP';
  }
  else if (frameProtos.includes('gre')) {
    detectedProtocol = 'GRE';
  }
  else if (frameProtos.includes('vxlan')) {
    detectedProtocol = 'VXLAN';
  }
  else if (frameProtos.includes('geneve')) {
    detectedProtocol = 'Geneve';
  }
  // QUIC — tshark dissects HTTP/3 and QUIC as first-class protocols
  else if (frameProtos.includes('quic')) {
    // If also has 'dns' in stack = DNS-over-QUIC
    if (frameProtos.includes('dns')) detectedProtocol = 'DoQ';
    else detectedProtocol = 'QUIC';
  }
  // DoH — tshark sees this as http2 or http3 carrying a dns query
  else if (frameProtos.includes('dns') && (
    frameProtos.includes('tls') ||
    frameProtos.includes('http2') ||
    frameProtos.includes('http3')
  )) {
    detectedProtocol = 'DoH';
  }
  // DoT — DNS over TLS on port 853
  else if (frameProtos.includes('dns') && frameProtos.includes('tls') && dstPort === 853) {
    detectedProtocol = 'DoT';
  }
  // Plain DNS
  else if (frameProtos.includes('mdns')) {
    detectedProtocol = 'mDNS';
  }
  else if (frameProtos.includes('llmnr')) {
    detectedProtocol = 'LLMNR';
  }
  else if (frameProtos.includes('dns')) {
    detectedProtocol = 'DNS';
  }
  // SSH
  else if (frameProtos.includes('ssh')) {
    detectedProtocol = 'SSH';
  }
  // Streaming / media
  else if (frameProtos.includes('rtmp')) detectedProtocol = 'RTMP';
  else if (frameProtos.includes('rtp'))  detectedProtocol = 'RTP';
  else if (frameProtos.includes('rtsp')) detectedProtocol = 'RTSP';
  else if (frameProtos.includes('srt'))  detectedProtocol = 'SRT';
  else if (frameProtos.includes('stun') || frameProtos.includes('dtls')) {
    detectedProtocol = 'WebRTC';
  }
  // Messaging
  else if (frameProtos.includes('xmpp')) detectedProtocol = 'XMPP';
  else if (frameProtos.includes('mqtt')) detectedProtocol = 'MQTT';
  // HTTP (unencrypted)
  else if (frameProtos.includes('http2') || frameProtos.includes('http3')) {
    detectedProtocol = 'HTTPS'; // encrypted HTTP
  }
  else if (frameProtos.includes('http')) {
    detectedProtocol = 'HTTP';
  }
  // TLS without further dissection = HTTPS
  else if (frameProtos.includes('tls')) {
    detectedProtocol = 'HTTPS';
  }
  // Transport fallbacks
  else if (frameProtos.includes('icmp')) detectedProtocol = 'ICMP';
  else if (frameProtos.includes('tcp'))  detectedProtocol = 'TCP';
  else if (frameProtos.includes('udp'))  detectedProtocol = 'UDP';

  // Raw transport for the protocol field
  let protocol = 'TCP';
  if (frameProtos.includes('udp'))  protocol = 'UDP';
  if (frameProtos.includes('icmp')) protocol = 'ICMP';

  return {
    srcIp,
    dstIp,
    srcPort,
    dstPort,
    protocol,
    detectedProtocol,
    length,
    direction,
    tlsVersion: layers['tls.record.version'] as string | undefined,
    quicVersion: layers['quic.version'] as string | undefined,
    wireguardMsgType: layers['wg.type'] as string | undefined,
    httpHost: (layers['tls.handshake.extensions_server_name'] ??
               layers['http.host']) as string | undefined,
    dnsQuery: layers['dns.qry.name'] as string | undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// TCPDUMP — fallback (macOS/Linux, no DPI)
// Falls back to port-based detection via the classify.ts heuristics
// ─────────────────────────────────────────────────────────────

export function startTcpdump(
  iface: string,
  localIps: Set<string>,
  onPacket: (p: RawPacket) => void,
) {
  // -i: interface, -l: line buffered, -n: no name resolution
  // -q: brief output, -t: no timestamp, -U: packet-buffered
  // output format: "IP 1.2.3.4.12345 > 5.6.7.8.443: TCP, length 52"
  const proc = spawn('tcpdump', [
    '-i', iface, '-l', '-n', '-q', '-t', '-U',
    'not port 8090',
  ]);

  proc.stdout.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      const pkt = parseTcpdumpLine(line, localIps);
      if (pkt) onPacket(pkt);
    }
  });

  return proc;
}

function parseTcpdumpLine(
  line: string,
  localIps: Set<string>,
): RawPacket | null {
  // "IP 192.168.1.5.54821 > 142.250.80.46.443: Flags [.], length 52"
  const m = line.match(
    /IP(?:v6)?\s+([\d.a-f:]+)\.(\d+)\s+>\s+([\d.a-f:]+)\.(\d+):\s+(\w+)/i
  );
  if (!m) return null;

  const [, srcIp, srcPortS, dstIp, dstPortS, protoHint] = m;
  const srcPort = Number(srcPortS);
  const dstPort = Number(dstPortS);
  const protocol = protoHint.includes('UDP') ? 'UDP' :
                   protoHint.includes('ICMP') ? 'ICMP' : 'TCP';

  const direction = localIps.has(srcIp) ? 'outbound' : 'inbound';

  // Port-based heuristics only — no DPI available
  // Import from classify.ts port-based fallback
  const detectedProtocol = portBasedDetect(protocol, dstPort);

  const lenMatch = line.match(/length (\d+)/);
  const length = lenMatch ? Number(lenMatch[1]) : 0;

  return { srcIp, dstIp, srcPort, dstPort, protocol, detectedProtocol,
           length, direction };
}

// Port-based fallback used by tcpdump and pcap backends
// Less accurate than tshark DPI — OpenVPN on 443 will look like HTTPS etc.
function portBasedDetect(protocol: string, port: number): DetectedProtocol {
  if (port === 53)    return 'DNS';
  if (port === 5353)  return 'mDNS';
  if (port === 853)   return protocol === 'UDP' ? 'DoQ' : 'DoT';
  if (port === 51820 || port === 51821) return 'WireGuard';
  if (port === 1194)  return protocol === 'UDP' ? 'OpenVPN' : 'OpenVPN';
  if (port === 500)   return 'IKEv2';
  if (port === 4500)  return 'IKEv2';   // NAT-T
  if (port === 1701)  return 'L2TP';
  if (port === 1723)  return 'PPTP';
  if (port === 4789)  return 'VXLAN';
  if (port === 22)    return 'SSH';
  if (port === 443 && protocol === 'UDP') return 'QUIC';
  if (port === 443)   return 'HTTPS';
  if (port === 80)    return 'HTTP';
  if (protocol === 'ICMP') return 'ICMP';
  if (protocol === 'UDP')  return 'UDP';
  return 'TCP';
}

// ─────────────────────────────────────────────────────────────
// BACKEND SELECTOR — auto-detect what's available
// ─────────────────────────────────────────────────────────────

export type CaptureBackend = 'tshark' | 'tcpdump' | 'pcap';

export function detectBackend(): CaptureBackend {
  try {
    execSync('tshark --version', { stdio: 'ignore' });
    console.log('[capture] Backend: tshark (full DPI)');
    return 'tshark';
  } catch {}

  if (os.platform() !== 'win32') {
    try {
      execSync('tcpdump --version', { stdio: 'ignore' });
      console.log('[capture] Backend: tcpdump (port-based detection)');
      return 'tcpdump';
    } catch {}
  }

  console.log('[capture] Backend: node-pcap (port-based detection)');
  return 'pcap';
}

// ─────────────────────────────────────────────────────────────
// GEOIP + REVERSE DNS
// ─────────────────────────────────────────────────────────────

const dnsCache = new LRUCache<string, string>({ max: 2000, ttl: 1000 * 60 * 30 });

export async function resolveHostname(ip: string): Promise<string> {
  if (dnsCache.has(ip)) return dnsCache.get(ip)!;
  try {
    const hostnames = await dns.reverse(ip);
    const result = hostnames[0] ?? ip;
    dnsCache.set(ip, result);
    return result;
  } catch {
    dnsCache.set(ip, ip);
    return ip;
  }
}

// geoip-lite is offline + zero-config but carries only lat/lng/country/city.
// It has NO ASN/org data, so `org` is always 'Unknown' here. Wire in a
// separate ASN database later if real org names are needed. Lookup is sync.
export function geoLookup(
  ip: string,
): { lat: number; lng: number; country: string; city: string; org: string } | null {
  const geo = geoip.lookup(ip);
  if (!geo) return null;
  return {
    lat:     geo.ll?.[0] ?? 0,
    lng:     geo.ll?.[1] ?? 0,
    country: geo.country ?? 'XX',
    city:    geo.city ?? '',
    org:     'Unknown',
  };
}

// ─────────────────────────────────────────────────────────────
// HOME AIRPORT DETECTION
// Determines 1–3 home airports from active source IPs
// Handles: single IP, full-tunnel VPN, split-tunnel VPN
// ─────────────────────────────────────────────────────────────

interface HomeAirport {
  id: string;
  label: string;
  lat: number;
  lng: number;
  ip: string;
  isVpn: boolean;
}

export function detectHomeAirports(
  sourceIps: string[],
): HomeAirport[] {
  // GeoIP every source IP (geoip-lite is synchronous)
  const resolved = sourceIps.map(ip => {
    const geo = geoLookup(ip);
    return geo ? { ip, ...geo } : null;
  });

  const valid = resolved.filter(Boolean) as Array<{
    ip: string; lat: number; lng: number; country: string; city: string; org: string;
  }>;

  if (valid.length === 0) return [];

  // Cluster: IPs within 100km = same airport
  const clusters: typeof valid[] = [];
  for (const point of valid) {
    let added = false;
    for (const cluster of clusters) {
      if (haversineKm(
        point.lat, point.lng,
        cluster[0].lat, cluster[0].lng,
      ) < 100) {
        cluster.push(point);
        added = true;
        break;
      }
    }
    if (!added) clusters.push([point]);
  }

  // First cluster = primary (highest traffic volume would be tracked
  // in real impl; for now just use first). Others = VPN exits.
  return clusters.slice(0, 3).map((cluster, i) => {
    const rep = cluster[0]; // representative point
    return {
      id:    i === 0 ? 'primary' : `vpn-${i}`,
      label: `${rep.country}${i > 0 ? ' (VPN)' : ''}`,
      lat:   rep.lat,
      lng:   rep.lng,
      ip:    rep.ip,
      isVpn: i > 0,
    };
  });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
