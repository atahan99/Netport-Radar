// server/flow-tracker.ts
// Correlates RawPackets into flows (one per logical connection), runs the
// phase machine, and emits FlightEvents. Server owns phase + metrics; the
// client animates arcProgress.

import type { Flight, FlightEvent, FlightPhase, HomeAirport } from '../src/types';
import { classify } from '../src/lib/classify';
import { liveryColor } from '../src/lib/livery';
import { geoLookup, resolveHostname, type RawPacket } from './capture';

const DNS_HOLD_MS = 2000;
const HOLD_IDLE_MS = 5000;
const DESCENT_MS = 2000;
const STALE_MS = 120_000;
const CLOSED_TTL_MS = 30_000;

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
  lastEmittedBytes: number;
  bps: { t: number; bytes: number }[]; // rolling 3s window
}

function isLoopback(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1' || ip.startsWith('0:0:0:0:0:0:0:1');
}

function isPrivate(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  const l = ip.toLowerCase();
  return l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
}

// Multicast (224–239.x, IPv6 ff00::/8) + broadcast — local discovery chatter
// (SSDP, mDNS, …). Dropped like loopback so it never becomes a "flight".
function isMulticast(ip: string): boolean {
  if (ip === '255.255.255.255') return true;
  const first = parseInt(ip, 10);
  if (first >= 224 && first <= 239) return true;
  return ip.toLowerCase().startsWith('ff');
}

let counter = 0;
function callsign(proto: string): string {
  const prefix = (proto.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'NET').toUpperCase();
  const hex = ((counter++ * 2654435761) % 0x10000).toString(16).toUpperCase().padStart(4, '0');
  return `${prefix}-${hex}`;
}

function flagEmoji(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export interface FlowTrackerOpts {
  getHomeAirports: () => HomeAirport[];
  onEvent: (e: FlightEvent) => void;
  onSourceIp: (ip: string) => void; // feed home-airport detection
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

  ingest(p: RawPacket): void {
    // never shown/logged: loopback + multicast/broadcast (local discovery chatter)
    if (isLoopback(p.srcIp) || isLoopback(p.dstIp) || isMulticast(p.dstIp)) return;

    const out = p.direction === 'outbound';
    const localIp = out ? p.srcIp : p.dstIp;
    const localPort = out ? p.srcPort : p.dstPort;
    const remoteIp = out ? p.dstIp : p.srcIp;
    const remotePort = out ? p.dstPort : p.srcPort;
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
    // LAN dst has no GeoIP — park it at home (the LAN orbit visual is deferred).
    const dstLat = geo ? geo.lat : home?.lat ?? 0;
    const dstLng = geo ? geo.lng : home?.lng ?? 0;

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
      country: geo?.country ?? (lan ? 'LAN' : 'XX'),
      countryFlag: geo ? flagEmoji(geo.country) : '',
      city: geo?.city || (lan ? 'Local network' : 'Unknown'),
      org: geo?.org ?? 'Unknown',
      asn: '',
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
        flow.flight.liveryColor = liveryColor(name);
        if (flow.opened) this.opts.onEvent({ event: 'hostname', id: flow.flight.id, hostname: name });
      });
    }

    return {
      flight,
      opened: false,
      createdAt: now,
      launchAt: now,
      lastPacketAt: now,
      finRst: false,
      hostnameResolved: false,
      lastEmittedBytes: -1,
      bps: [],
    };
  }

  private resolveHome(localIp: string): HomeAirport | undefined {
    const homes = this.opts.getHomeAirports();
    return homes.find((h) => h.ip === localIp) ?? homes.find((h) => h.id === 'primary') ?? homes[0];
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

      // throttled metric update
      if (f.bytesTotal !== flow.lastEmittedBytes) {
        flow.lastEmittedBytes = f.bytesTotal;
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
