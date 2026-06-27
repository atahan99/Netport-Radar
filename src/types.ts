// netport-radar — shared types. Single source of truth, imported everywhere.

export type FlightPhase =
  | 'taxi' // waiting for DNS (max 2s), sitting at home airport
  | 'cruise' // active data flowing, moving along arc
  | 'hold' // idle >5s, circling near destination
  | 'descent' // FIN/RST, curving toward destination
  | 'landed'; // closed, fading out

export type AircraftType =
  | 'widebody'
  | 'narrowbody'
  | 'cargo'
  | 'helicopter'
  | 'privatejet'
  | 'satellite'
  | 'drone'
  | 'ambulance'
  | 'stealth'
  | 'broadcast';

export type DetectedProtocol =
  | 'HTTPS'
  | 'HTTP'
  | 'TCP'
  | 'UDP'
  | 'ICMP'
  | 'ICMPv6'
  | 'DNS'
  | 'mDNS'
  | 'LLMNR'
  | 'DoT'
  | 'DoH'
  | 'DoQ'
  | 'QUIC'
  | 'WireGuard'
  | 'OpenVPN'
  | 'IKEv2'
  | 'IPSec-ESP'
  | 'L2TP'
  | 'PPTP'
  | 'GRE'
  | 'VXLAN'
  | 'Geneve'
  | 'SSH'
  | 'Tor'
  | 'RTMP'
  | 'RTP'
  | 'RTSP'
  | 'SRT'
  | 'WebRTC'
  | 'Steam'
  | 'EAC'
  | 'BattleNet'
  | 'XMPP'
  | 'MQTT'
  | 'Unknown';

export interface HomeAirport {
  id: string; // 'primary' | 'vpn-1' | 'vpn-2'
  label: string; // e.g. "Istanbul, TR"
  lat: number;
  lng: number;
  ip: string;
  isVpn: boolean;
}

export interface Flight {
  // Identity
  id: string; // e.g. "CHR-4F2A"
  process: string; // normalized e.g. "chrome"
  processRaw: string; // raw OS name e.g. "Google Chrome Helper"
  pid: number;

  // Network
  protocol: string; // raw: TCP/UDP/ICMP
  detectedProtocol: DetectedProtocol;
  port: number; // remote port
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  isIPv6: boolean;

  // Geography
  homeAirportId: string;
  dstLat: number;
  dstLng: number;
  country: string; // ISO e.g. "US"
  countryFlag: string; // e.g. "🇺🇸"
  city: string;
  org: string;
  asn: string;
  hostname: string; // may be IP string before DNS resolves
  sni?: string;

  // Classification
  aircraftType: AircraftType;
  phase: FlightPhase;
  liveryColor: string; // hex

  // Metrics
  bytesTotal: number;
  bytesTx: number;
  bytesRx: number;
  bytesPerSec: number;
  packetsTotal: number;
  durationMs: number;
  arcProgress: number; // 0.0–1.0

  // Meta
  direction: 'outbound' | 'inbound';
  isLan: boolean;
  startedAt: number;
  landedAt?: number; // Date.now() when the flight closed (for the board linger)
  hostnameResolved: boolean;
}

// ── WebSocket protocol (server → client only) ──────────────────────────────

export interface BackendInfo {
  capture: 'tshark' | 'tcpdump' | 'pcap';
  dpiMode: 'full' | 'port-based';
  iface: string;
  interfaces: string[];
}

export type FlightEvent =
  | { event: 'opened'; flight: Flight }
  | { event: 'updated'; id: string; patch: Partial<Flight> }
  | { event: 'phase'; id: string; phase: FlightPhase }
  | { event: 'closed'; id: string; bytesTotal: number; durationMs: number }
  | { event: 'hostname'; id: string; hostname: string; sni?: string };

export type ServerMessage =
  | { type: 'init'; homeAirports: HomeAirport[]; backend: BackendInfo }
  | { type: 'batch'; events: FlightEvent[] }
  | { type: 'home_update'; homeAirports: HomeAirport[] }
  | { type: 'reset' }
  | { type: 'log'; ndjson: string }
  | { type: 'error'; code: string; message: string };

// Client → server control (Phase 4): interface switching + log export.
export type ClientMessage =
  | { type: 'switch_iface'; iface: string }
  | { type: 'export' };

