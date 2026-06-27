// server/net-utils.ts
// Pure address/string helpers used by the flow tracker. Extracted here so they
// can be unit-tested without constructing a FlowTracker (and reused elsewhere).

export function isLoopback(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1' || ip.startsWith('0:0:0:0:0:0:0:1');
}

// 100.64.0.0/10 — carrier-grade NAT; this is where Tailscale/Headscale peers
// live. Not geolocatable, so treat as LAN (orbit home) rather than geo-miss.
export function isCgnat(ip: string): boolean {
  const m = ip.match(/^100\.(\d+)\./);
  return !!m && +m[1] >= 64 && +m[1] <= 127;
}

export function isPrivate(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (isCgnat(ip)) return true;
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return true; // 198.18/15 benchmarking
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  const l = ip.toLowerCase();
  return l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
}

// City label for a parked LAN destination.
export function lanCity(ip: string): string {
  if (isCgnat(ip)) return 'Tailscale / CGNAT';
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return 'Test range';
  return 'Local network';
}

// Deterministic hash → stable "unknown shelf" coords for un-geolocatable public IPs.
export function hashIp(ip: string): number {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) >>> 0;
  return h;
}

// Multicast (224–239.x, IPv6 ff00::/8) + broadcast — local discovery chatter
// (SSDP, mDNS, …). Dropped like loopback so it never becomes a "flight".
export function isMulticast(ip: string): boolean {
  if (ip === '255.255.255.255') return true;
  const first = parseInt(ip, 10);
  if (first >= 224 && first <= 239) return true;
  return ip.toLowerCase().startsWith('ff');
}

// 6 hex chars (24-bit) + a uniqueness set so callsigns never collide within a
// session — a collision would corrupt client marker/selection state.
let counter = 0;
const usedCallsigns = new Set<string>();
export function callsign(proto: string): string {
  const prefix = (proto.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'NET').toUpperCase();
  let cs: string;
  do {
    const hex = ((counter++ * 2654435761) >>> 0)
      .toString(16)
      .toUpperCase()
      .padStart(6, '0')
      .slice(-6);
    cs = `${prefix}-${hex}`;
  } while (usedCallsigns.has(cs));
  usedCallsigns.add(cs);
  return cs;
}

export function resetCallsigns(): void {
  usedCallsigns.clear();
}

export function flagEmoji(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
