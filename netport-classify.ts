// src/lib/classify.ts
// netport-radar — protocol classification + UI display helpers
//
// Types live in src/types.ts and are imported here — this file no longer
// redefines DetectedProtocol/AircraftType (single source of truth).
//
// When tshark is the capture backend, DetectedProtocol is resolved via full
// DPI before this file is ever called. When tcpdump/pcap is the fallback,
// port-based heuristics in capture.ts produce a best-effort DetectedProtocol.
// Either way, this file only sees the already-resolved DetectedProtocol type
// and maps it to aircraft + UI labels. No port sniffing here.
//
// Note: classify() drives LIVE data (Phase 3). The Phase 1 demo does NOT call
// it — each PROCESS_POOL entry carries a hardcoded aircraft type instead.

import type { DetectedProtocol, AircraftType } from '../types';

// ─────────────────────────────────────────────────────────────
// AIRCRAFT TYPE
// ─────────────────────────────────────────────────────────────

const VPN_PROTOCOLS = new Set<DetectedProtocol>([
  'WireGuard', 'OpenVPN', 'IKEv2', 'IPSec-ESP',
  'L2TP', 'PPTP', 'GRE', 'VXLAN', 'Geneve',
]);

const DNS_PROTOCOLS = new Set<DetectedProtocol>([
  'DNS', 'mDNS', 'LLMNR', 'DoT', 'DoH', 'DoQ',
]);

const STREAM_PROTOCOLS = new Set<DetectedProtocol>([
  'RTMP', 'RTP', 'RTSP', 'SRT', 'WebRTC',
]);

const GAMING_PROTOCOLS = new Set<DetectedProtocol>([
  'Steam', 'EAC', 'BattleNet',
]);

export function classify(
  protocol: DetectedProtocol,
  bytesTotal: number,
  durationMs: number,
): AircraftType {
  if (VPN_PROTOCOLS.has(protocol))    return 'privatejet';
  if (DNS_PROTOCOLS.has(protocol))    return 'drone';
  if (STREAM_PROTOCOLS.has(protocol)) return 'broadcast';
  if (GAMING_PROTOCOLS.has(protocol)) return 'helicopter';

  if (protocol === 'ICMP' || protocol === 'ICMPv6') return 'ambulance';
  if (protocol === 'SSH' || protocol === 'Tor')     return 'stealth';
  if (protocol === 'QUIC')                          return 'helicopter';
  if (protocol === 'HTTP')                          return 'narrowbody';
  if (protocol === 'MQTT' || protocol === 'XMPP')  return 'helicopter';

  if (protocol === 'HTTPS' || protocol === 'TCP') {
    // Long-lived + high volume = satellite (Spotify, Discord, Slack)
    const isLongLived = durationMs > 60_000;          // >1 min
    const isHighVolume = bytesTotal > 100_000_000;    // >100 MB
    if (isLongLived && isHighVolume) return 'satellite';

    // Heavy transfer = cargo (Steam, OS updates, backups)
    if (bytesTotal > 10_000_000) return 'cargo';

    return 'widebody';
  }

  if (protocol === 'UDP') return 'helicopter';

  return 'widebody';
}

// ─────────────────────────────────────────────────────────────
// UI LABELS
// ─────────────────────────────────────────────────────────────

export const PROTOCOL_LABELS: Record<DetectedProtocol, string> = {
  'HTTPS':      'HTTPS',
  'HTTP':       'HTTP',
  'TCP':        'TCP',
  'UDP':        'UDP',
  'ICMP':       'ICMP',
  'ICMPv6':     'ICMPv6',
  'DNS':        'DNS',
  'mDNS':       'mDNS',
  'LLMNR':      'LLMNR',
  'DoT':        'DNS-over-TLS',
  'DoH':        'DNS-over-HTTPS',
  'DoQ':        'DNS-over-QUIC',
  'QUIC':       'HTTP/3 QUIC',
  'WireGuard':  'WireGuard',
  'OpenVPN':    'OpenVPN',
  'IKEv2':      'IKEv2 / IPSec',
  'IPSec-ESP':  'IPSec ESP',
  'L2TP':       'L2TP / IPSec',
  'PPTP':       'PPTP',
  'GRE':        'GRE Tunnel',
  'VXLAN':      'VXLAN',
  'Geneve':     'Geneve',
  'SSH':        'SSH Tunnel',
  'Tor':        'Tor',
  'RTMP':       'RTMP Stream',
  'RTP':        'RTP Media',
  'RTSP':       'RTSP',
  'SRT':        'SRT Stream',
  'WebRTC':     'WebRTC',
  'Steam':      'Steam',
  'EAC':        'Easy Anti-Cheat',
  'BattleNet':  'Battle.net',
  'XMPP':       'XMPP',
  'MQTT':       'MQTT',
  'Unknown':    'Unknown',
};

// ─────────────────────────────────────────────────────────────
// BADGE COLORS (Tailwind classes)
// ─────────────────────────────────────────────────────────────

export function protocolBadgeClass(protocol: DetectedProtocol): string {
  if (VPN_PROTOCOLS.has(protocol))
    return 'bg-violet-900/60 text-violet-300 border border-violet-700';

  if (DNS_PROTOCOLS.has(protocol))
    return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700';

  if (STREAM_PROTOCOLS.has(protocol))
    return 'bg-pink-900/60 text-pink-300 border border-pink-700';

  if (GAMING_PROTOCOLS.has(protocol))
    return 'bg-orange-900/60 text-orange-300 border border-orange-700';

  const map: Partial<Record<DetectedProtocol, string>> = {
    'HTTPS':   'bg-blue-900/60 text-blue-300 border border-blue-700',
    'HTTP':    'bg-amber-900/60 text-amber-300 border border-amber-700',
    'QUIC':    'bg-teal-900/60 text-teal-300 border border-teal-700',
    'ICMP':    'bg-green-900/60 text-green-300 border border-green-700',
    'ICMPv6':  'bg-green-900/60 text-green-300 border border-green-700',
    'UDP':     'bg-purple-900/60 text-purple-300 border border-purple-700',
    'TCP':     'bg-zinc-700/60 text-zinc-300 border border-zinc-600',
    'SSH':     'bg-red-900/60 text-red-300 border border-red-700',
    'Tor':     'bg-red-900/60 text-red-300 border border-red-700',
    'MQTT':    'bg-cyan-900/60 text-cyan-300 border border-cyan-700',
    'XMPP':    'bg-cyan-900/60 text-cyan-300 border border-cyan-700',
  };

  return map[protocol] ?? 'bg-zinc-700/60 text-zinc-300 border border-zinc-600';
}

// ─────────────────────────────────────────────────────────────
// AIRCRAFT TYPE LABELS (for legend / tooltip)
// ─────────────────────────────────────────────────────────────

export const AIRCRAFT_LABELS: Record<AircraftType, string> = {
  widebody:   'Wide-body airliner',
  narrowbody: 'Narrow-body jet',
  cargo:      'Cargo freighter',
  helicopter: 'Helicopter / prop',
  privatejet: 'Private jet',
  satellite:  'Satellite relay',
  drone:      'Recon drone',
  ambulance:  'Air ambulance',
  stealth:    'Stealth aircraft',
  broadcast:  'Broadcast tanker',
};
