// server/flow-tracker.ts
// Correlates RawPackets into flows (one per logical connection), runs the
// phase machine, and emits FlightEvents. Server owns phase + metrics; the
// client animates arcProgress.

import type { Flight, FlightEvent, FlightPhase, HomeAirport } from '../src/types';
import { classify } from '../src/lib/classify';
import { liveryColor } from '../src/lib/livery';
import { geoLookup, resolveHostname, type RawPacket } from './capture';
import { lookupProcess } from './process-names';

const DNS_HOLD_MS = 2000;
const HOLD_IDLE_MS = 5000;
const DESCENT_MS = 2000;
const STALE_MS = 120_000;
const CLOSED_TTL_MS = 30_000;

// DoH can't be seen by DPI (the DNS lives inside TLS, so frame.protocols shows
// only tls/http2 → detected as HTTPS). When the SNI/hostname is a known public
// resolver, reclassify to DoH (→ drone, DNS family). List-based, not DPI.
const DOH_HOSTS = new Set([
  'dns.google',
  'cloudflare-dns.com',
  'one.one.one.one',
  'mozilla.cloudflare-dns.com',
  'dns.quad9.net',
  'doh.opendns.com',
  'dns.nextdns.io',
]);

interface Flow {
  flight: Flight;
  opened: boolean;
  createdAt: number;
  launchAt: number; // end of taxi / when opened
  lastPacketAt: number;
  closedAt?: number;
  descentAt?: number;
  finRst: boolean;
  hostnameResolved: boolean;
  processResolved: boolean;
  lastEmittedBytes: number;
  lastEmittedBps: number;
  bps: { t: number; bytes: number }[]; // rolling 3s window
}

function isLoopback(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1' || ip.startsWith('0:0:0:0:0:0:0:1');
}

// 100.64.0.0/10 — carrier-grade NAT; this is where Tailscale/Headscale peers
// live. Not geolocatable, so treat as LAN (orbit home) rather than geo-miss.
function isCgnat(ip: string): boolean {
  const m = ip.match(/^100\.(\d+)\./);
  return !!m && +m[1] >= 64 && +m[1] <= 127;
}

function isPrivate(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (isCgnat(ip)) return true;
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return true; // 198.18/15 benchmarking
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  const l = ip.toLowerCase();
  return l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
}

// City label for a parked LAN destination.
function lanCity(ip: string): string {
  if (isCgnat(ip)) return 'Tailscale / CGNAT';
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return 'Test range';
  return 'Local network';
}

// Deterministic hash → stable "unknown shelf" coords for un-geolocatable public IPs.
function hashIp(ip: string): number {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) >>> 0;
  return h;
}

// Multicast (224–239.x, IPv6 ff00::/8) + broadcast — local discovery chatter
// (SSDP, mDNS, …). Dropped like loopback so it never becomes a "flight".
function isMulticast(ip: string): boolean {
  if (ip === '255.255.255.255') return true;
  const first = parseInt(ip, 10);
  if (first >= 224 && first <= 239) return true;
  return ip.toLowerCase().startsWith('ff');
}

// 6 hex chars (24-bit) + a uniqueness set so callsigns never collide within a
// session — a collision would corrupt client marker/selection state. The old
// 16-bit space hit ~50% collision odds after a few hundred flights.
let counter = 0;
const usedCallsigns = new Set<string>();
function callsign(proto: string): string {
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

function flagEmoji(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export interface FlowTrackerOpts {
  getHomeAirports: () => HomeAirport[];
  onEvent: (e: FlightEvent) => void;
  onSourceIp: (ip: string) => void; // feed home-airport detection
  selfProbeIps?: Set<string>; // geo-lookup provider IPs — never become flights
}

export class FlowTracker {
  private flows = new Map<string, Flow>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private opts: FlowTrackerOpts) {
    this.timer = setInterval(() => this.tick(), 250);
  }

  stop() {
    clearInterval(this.timer);
  }

  clear(): void {
    this.flows.clear();
    usedCallsigns.clear();
  }

  ingest(p: RawPacket): void {
    // never shown/logged: loopback + multicast/broadcast (local discovery chatter)
    if (isLoopback(p.srcIp) || isLoopback(p.dstIp) || isMulticast(p.dstIp)) return;
    // self-noise: reverse-DNS (ours + the OS's) shouldn't appear as DNS flights
    if (p.host && (p.host.endsWith('.in-addr.arpa') || p.host.endsWith('.ip6.arpa'))) return;

    const out = p.direction === 'outbound';
    const localIp = out ? p.srcIp : p.dstIp;
    const localPort = out ? p.srcPort : p.dstPort;
    const remoteIp = out ? p.dstIp : p.srcIp;
    const remotePort = out ? p.dstPort : p.srcPort;
    // the one geo-lookup we make at boot shouldn't show up as a flight
    if (this.opts.selfProbeIps?.has(remoteIp)) return;
    const key = `${localIp}:${localPort}>${remoteIp}:${remotePort}:${p.protocol}`;

    if (out) this.opts.onSourceIp(localIp);

    let flow = this.flows.get(key);
    const now = Date.now();
    if (!flow) {
      flow = this.create(p, localIp, localPort, remoteIp, remotePort, now);
      this.flows.set(key, flow);
    }
    if (flow.closedAt) return; // ignore packets after close

    const f = flow.flight;
    if (out) f.bytesTx += p.length;
    else f.bytesRx += p.length;
    f.bytesTotal = f.bytesTx + f.bytesRx;
    f.packetsTotal++;
    flow.lastPacketAt = now;
    flow.bps.push({ t: now, bytes: p.length });
    if (p.tcpFin || p.tcpRst) flow.finRst = true;
    if (p.host && !flow.hostnameResolved) {
      f.hostname = p.host;
      f.sni = p.host;
      flow.hostnameResolved = true;
      f.hostnameResolved = true;
      if (flow.opened) this.opts.onEvent({ event: 'hostname', id: f.id, hostname: p.host, sni: p.host });
      this.maybeReclassifyDoH(flow);
    }
    // data resumes → back to cruise
    if (flow.opened && f.phase === 'hold') this.setPhase(flow, 'cruise');
  }

  private create(
    p: RawPacket,
    localIp: string,
    localPort: number,
    remoteIp: string,
    remotePort: number,
    now: number,
  ): Flow {
    const geo = geoLookup(remoteIp);
    const home = this.resolveHome(localIp);
    const lan = isPrivate(remoteIp);

    // Destination placement (the display must not lie about where this goes):
    //  • LAN → park at home, it orbits there (Phase 5 LAN orbit).
    //  • known geo → real coords.
    //  • public but un-geolocatable → a deterministic "unknown shelf" in the
    //    mid-Atlantic with country '??' — honest "somewhere, location unknown",
    //    never confused with home/LAN.
    let dstLat: number;
    let dstLng: number;
    let country: string;
    let city: string;
    let flag: string;
    if (lan) {
      dstLat = home?.lat ?? 0;
      dstLng = home?.lng ?? 0;
      country = 'LAN';
      city = lanCity(remoteIp);
      flag = '';
    } else if (geo) {
      dstLat = geo.lat;
      dstLng = geo.lng;
      country = geo.country;
      city = geo.city || 'Unknown';
      flag = flagEmoji(geo.country);
    } else {
      const j = hashIp(remoteIp);
      dstLat = -5 + (j % 1000) / 100; // -5..5
      dstLng = -30 + (Math.floor(j / 1000) % 1600) / 100; // -30..-14
      country = '??';
      city = 'Unknown location';
      flag = '';
    }

    const flight: Flight = {
      id: callsign(p.detectedProtocol),
      process: '—',
      processRaw: '',
      pid: 0,
      protocol: p.protocol,
      detectedProtocol: p.detectedProtocol,
      port: remotePort,
      srcIp: localIp,
      dstIp: remoteIp,
      srcPort: localPort,
      dstPort: remotePort,
      isIPv6: p.isIPv6,
      homeAirportId: home?.id ?? 'primary',
      dstLat,
      dstLng,
      country,
      countryFlag: flag,
      city,
      org: geo?.org ?? 'Unknown',
      asn: geo?.asn ?? '',
      hostname: remoteIp,
      sni: undefined,
      aircraftType: classify(p.detectedProtocol, 0, 0),
      phase: 'taxi',
      liveryColor: liveryColor(remoteIp),
      bytesTotal: 0,
      bytesTx: 0,
      bytesRx: 0,
      bytesPerSec: 0,
      packetsTotal: 0,
      durationMs: 0,
      arcProgress: 0,
      direction: p.direction,
      isLan: lan,
      startedAt: now,
      hostnameResolved: false,
    };

    // async reverse DNS (in case no SNI/host comes through)
    if (!lan) {
      void resolveHostname(remoteIp).then((name) => {
        const flow = this.flows.get(`${localIp}:${localPort}>${remoteIp}:${remotePort}:${p.protocol}`);
        if (!flow || flow.hostnameResolved || name === remoteIp) return;
        flow.flight.hostname = name;
        flow.hostnameResolved = true;
        flow.flight.hostnameResolved = true;
        // Process livery (brand color) wins; only hash the hostname when the
        // owning process is still unknown.
        if (!flow.processResolved) flow.flight.liveryColor = liveryColor(name);
        if (flow.opened) this.opts.onEvent({ event: 'hostname', id: flow.flight.id, hostname: name });
        this.maybeReclassifyDoH(flow);
      });
    }

    const flow: Flow = {
      flight,
      opened: false,
      createdAt: now,
      launchAt: now,
      lastPacketAt: now,
      finRst: false,
      hostnameResolved: false,
      processResolved: false,
      lastEmittedBytes: -1,
      lastEmittedBps: -1,
      bps: [],
    };
    this.resolveProcess(flow);
    return flow;
  }

  private resolveHome(localIp: string): HomeAirport | undefined {
    const homes = this.opts.getHomeAirports();
    return homes.find((h) => h.ip === localIp) ?? homes.find((h) => h.id === 'primary') ?? homes[0];
  }

  // Look up the owning process (lsof poll catches up within ~2s). Returns true
  // on the tick it first resolves, so the caller can emit a recolor patch.
  private resolveProcess(flow: Flow): boolean {
    if (flow.processResolved) return false;
    const proc = lookupProcess(flow.flight.srcPort, flow.flight.protocol);
    if (!proc) return false;
    const f = flow.flight;
    f.process = proc.process;
    f.processRaw = proc.processRaw;
    f.pid = proc.pid;
    f.liveryColor = liveryColor(proc.process);
    flow.processResolved = true;
    return true;
  }

  // SNI/hostname revealed a known DoH resolver → it's DNS traffic, not HTTPS.
  private maybeReclassifyDoH(flow: Flow): void {
    const f = flow.flight;
    if (f.detectedProtocol === 'DoH') return;
    const host = (f.sni || f.hostname || '').toLowerCase();
    if (!DOH_HOSTS.has(host)) return;
    f.detectedProtocol = 'DoH';
    f.aircraftType = classify('DoH', f.bytesTotal, f.durationMs);
    if (flow.opened) {
      this.opts.onEvent({
        event: 'updated',
        id: f.id,
        patch: { detectedProtocol: f.detectedProtocol, aircraftType: f.aircraftType },
      });
    }
  }

  private setPhase(flow: Flow, phase: FlightPhase): void {
    if (flow.flight.phase === phase) return;
    flow.flight.phase = phase;
    if (flow.opened) this.opts.onEvent({ event: 'phase', id: flow.flight.id, phase });
  }

  private tick(): void {
    const now = Date.now();
    for (const [key, flow] of this.flows) {
      const f = flow.flight;

      // closed flows: clean up after TTL
      if (flow.closedAt) {
        if (now - flow.closedAt > CLOSED_TTL_MS) this.flows.delete(key);
        continue;
      }

      // process attribution — late resolution recolors the plane
      if (this.resolveProcess(flow) && flow.opened) {
        this.opts.onEvent({
          event: 'updated',
          id: f.id,
          patch: {
            process: f.process,
            processRaw: f.processRaw,
            pid: f.pid,
            liveryColor: f.liveryColor,
          },
        });
      }

      // emit `opened` after the DNS hold (taxi)
      if (!flow.opened) {
        if (now - flow.createdAt >= DNS_HOLD_MS || flow.hostnameResolved) {
          flow.opened = true;
          flow.launchAt = now;
          f.phase = f.bytesTotal > 0 ? 'cruise' : 'taxi';
          this.opts.onEvent({ event: 'opened', flight: { ...f } });
        }
        continue;
      }

      // rolling 3s throughput
      flow.bps = flow.bps.filter((b) => now - b.t <= 3000);
      f.bytesPerSec = Math.round(flow.bps.reduce((s, b) => s + b.bytes, 0) / 3);
      f.durationMs = now - flow.launchAt;

      // late aircraft upgrade (cargo / satellite emerge with volume + time)
      const upgraded = classify(f.detectedProtocol, f.bytesTotal, f.durationMs);
      if (upgraded !== f.aircraftType) {
        f.aircraftType = upgraded;
        this.opts.onEvent({ event: 'updated', id: f.id, patch: { aircraftType: upgraded } });
      }

      // phase machine
      if (flow.finRst && f.phase !== 'descent') {
        flow.descentAt = now;
        this.setPhase(flow, 'descent');
      } else if (f.phase === 'descent' && flow.descentAt && now - flow.descentAt >= DESCENT_MS) {
        this.close(flow);
        continue;
      } else if (now - flow.lastPacketAt > STALE_MS) {
        this.close(flow);
        continue;
      } else if (f.phase === 'cruise' && now - flow.lastPacketAt > HOLD_IDLE_MS) {
        this.setPhase(flow, 'hold');
      }

      // throttled metric update — also fires when bytesPerSec changes (so the
      // rate decays to 0 on an idle/hold flow instead of freezing at its peak)
      if (f.bytesTotal !== flow.lastEmittedBytes || f.bytesPerSec !== flow.lastEmittedBps) {
        flow.lastEmittedBytes = f.bytesTotal;
        flow.lastEmittedBps = f.bytesPerSec;
        this.opts.onEvent({
          event: 'updated',
          id: f.id,
          patch: {
            bytesTotal: f.bytesTotal,
            bytesTx: f.bytesTx,
            bytesRx: f.bytesRx,
            bytesPerSec: f.bytesPerSec,
            packetsTotal: f.packetsTotal,
            durationMs: f.durationMs,
          },
        });
      }
    }
  }

  private close(flow: Flow): void {
    const f = flow.flight;
    flow.closedAt = Date.now();
    f.phase = 'landed';
    this.opts.onEvent({
      event: 'closed',
      id: f.id,
      bytesTotal: f.bytesTotal,
      durationMs: f.durationMs,
    });
  }
}
