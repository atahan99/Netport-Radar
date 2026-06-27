// server/flow-tracker.ts
// Correlates RawPackets into flows (one per logical connection), runs the
// phase machine, and emits FlightEvents. Server owns phase + metrics; the
// client animates arcProgress.

import type { Flight, FlightEvent, FlightPhase, HomeAirport } from '../src/types';
import { classify } from '../src/lib/classify';
import { liveryColor } from '../src/lib/livery';
import { geoLookup, resolveHostname, type RawPacket } from './capture';
import { lookupProcess } from './process-names';
import {
  DNS_HOLD_MS,
  HOLD_IDLE_MS,
  DESCENT_MS,
  STALE_MS,
  CLOSED_TTL_MS,
  EMIT_MIN_MS,
  TICK_MS,
} from './config';
import {
  isLoopback,
  isMulticast,
  isPrivate,
  lanCity,
  hashIp,
  callsign,
  resetCallsigns,
  flagEmoji,
  ipv6Prefix64,
  canonicalHost,
} from './net-utils';

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
  lastEmitAt: number;
  bps: { t: number; bytes: number }[]; // rolling 3s window
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
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Flow key — hostname merges v4/v6; IPv6 without host uses /64. */
  private flowKey(
    localIp: string,
    localPort: number,
    remoteIp: string,
    remotePort: number,
    proto: string,
    host?: string,
  ): string {
    const h = canonicalHost(host, remoteIp);
    if (h) return `${localIp}>host:${h}:${remotePort}:${proto}`;
    const remoteId = remoteIp.includes(':') ? `v6:${ipv6Prefix64(remoteIp)}` : `v4:${remoteIp}`;
    return `${localIp}:${localPort}>${remoteId}:${remotePort}:${proto}`;
  }

  private findFlow(
    localIp: string,
    localPort: number,
    remoteIp: string,
    remotePort: number,
    proto: string,
    host?: string,
  ): { key: string; flow: Flow | undefined } {
    // Literal 5-tuple wins — FIN/RST and data packets without SNI must stay on-session.
    for (const [k, f] of this.flows) {
      if (f.closedAt) continue;
      if (
        f.flight.srcIp === localIp &&
        f.flight.srcPort === localPort &&
        f.flight.dstIp === remoteIp &&
        f.flight.dstPort === remotePort &&
        f.flight.protocol === proto
      ) {
        return { key: k, flow: f };
      }
    }

    const key = this.flowKey(localIp, localPort, remoteIp, remotePort, proto, host);
    const direct = this.flows.get(key);
    if (direct) return { key, flow: direct };

    const h = canonicalHost(host, remoteIp);
    if (h) {
      for (const [k, f] of this.flows) {
        if (f.closedAt) continue;
        const fh = canonicalHost(f.flight.sni || f.flight.hostname, f.flight.dstIp);
        if (
          fh === h &&
          f.flight.srcIp === localIp &&
          f.flight.dstPort === remotePort &&
          f.flight.protocol === proto
        ) {
          return { key: k, flow: f };
        }
      }
    }
    return { key, flow: undefined };
  }

  private absorbFlow(keep: Flow, absorb: Flow, absorbKey: string): void {
    const k = keep.flight;
    const a = absorb.flight;
    k.bytesTx += a.bytesTx;
    k.bytesRx += a.bytesRx;
    k.bytesTotal += a.bytesTotal;
    k.packetsTotal += a.packetsTotal;
    if (a.isIPv6) k.isIPv6 = true;
    keep.lastPacketAt = Math.max(keep.lastPacketAt, absorb.lastPacketAt);
    keep.bps.push(...absorb.bps);
    if (absorb.hostnameResolved && !keep.hostnameResolved) {
      keep.flight.hostname = a.hostname;
      keep.flight.sni = a.sni;
      keep.hostnameResolved = true;
      keep.flight.hostnameResolved = true;
    }
    if (absorb.processResolved && !keep.processResolved) {
      keep.flight.process = a.process;
      keep.flight.processRaw = a.processRaw;
      keep.flight.pid = a.pid;
      keep.flight.liveryColor = a.liveryColor;
      keep.processResolved = true;
    }
    this.flows.delete(absorbKey);
    if (absorb.opened) {
      this.opts.onEvent({
        event: 'closed',
        id: a.id,
        bytesTotal: a.bytesTotal,
        durationMs: a.durationMs,
      });
    }
  }

  private tryRekeyByHostname(flow: Flow, key: string): void {
    const f = flow.flight;
    const h = canonicalHost(f.sni || f.hostname, f.dstIp);
    if (!h) return;
    const newKey = this.flowKey(f.srcIp, f.srcPort, f.dstIp, f.dstPort, f.protocol, h);
    if (newKey === key) return;

    const existing = this.flows.get(newKey);
    if (existing && existing !== flow) {
      this.absorbFlow(existing, flow, key);
      return;
    }

    for (const [, other] of this.flows) {
      if (other === flow || other.closedAt) continue;
      const oh = canonicalHost(other.flight.sni || other.flight.hostname, other.flight.dstIp);
      if (
        oh === h &&
        other.flight.srcIp === f.srcIp &&
        other.flight.dstPort === f.dstPort &&
        other.flight.protocol === f.protocol
      ) {
        this.absorbFlow(other, flow, key);
        return;
      }
    }

    this.flows.delete(key);
    this.flows.set(newKey, flow);
  }

  clear(): void {
    this.flows.clear();
    resetCallsigns();
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
    const host = p.host;

    if (out) this.opts.onSourceIp(localIp);

    const { key, flow: existing } = this.findFlow(
      localIp,
      localPort,
      remoteIp,
      remotePort,
      p.protocol,
      host,
    );

    let flow = existing;
    const now = Date.now();
    if (!flow) {
      flow = this.create(p, localIp, localPort, remoteIp, remotePort, now, key);
      this.flows.set(key, flow);
    }
    if (flow.closedAt) return; // ignore packets after close

    const f = flow.flight;
    if (p.isIPv6) f.isIPv6 = true;
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
      this.tryRekeyByHostname(flow, key);
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
    flowKey: string,
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
    let geoConfidence: Flight['geoConfidence'];
    if (lan) {
      dstLat = home?.lat ?? 0;
      dstLng = home?.lng ?? 0;
      country = 'LAN';
      city = lanCity(remoteIp);
      flag = '';
      geoConfidence = 'city';
    } else if (geo) {
      dstLat = geo.lat;
      dstLng = geo.lng;
      country = geo.country;
      city = geo.city || 'Unknown';
      flag = flagEmoji(geo.country);
      geoConfidence = geo.confidence;
    } else {
      const j = hashIp(remoteIp);
      dstLat = -5 + (j % 1000) / 100; // -5..5
      dstLng = -30 + (Math.floor(j / 1000) % 1600) / 100; // -30..-14
      country = '??';
      city = 'Unknown location';
      flag = '';
      geoConfidence = 'none';
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
      geoConfidence,
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
        const flow = this.flows.get(flowKey);
        if (!flow || flow.hostnameResolved || name === remoteIp) return;
        flow.flight.hostname = name;
        flow.hostnameResolved = true;
        flow.flight.hostnameResolved = true;
        // Process livery (brand color) wins; only hash the hostname when the
        // owning process is still unknown.
        if (!flow.processResolved) flow.flight.liveryColor = liveryColor(name);
        if (flow.opened) this.opts.onEvent({ event: 'hostname', id: flow.flight.id, hostname: name });
        this.maybeReclassifyDoH(flow);
        this.tryRekeyByHostname(flow, flowKey);
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
      lastEmitAt: 0,
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

      // throttled metric update — fires when bytes or rate changed (so the rate
      // decays to 0 on an idle flow) but at most once a second per flow. Phase,
      // hostname, recolor, opened and closed events stay immediate.
      if (
        (f.bytesTotal !== flow.lastEmittedBytes || f.bytesPerSec !== flow.lastEmittedBps) &&
        now - flow.lastEmitAt >= EMIT_MIN_MS
      ) {
        flow.lastEmittedBytes = f.bytesTotal;
        flow.lastEmittedBps = f.bytesPerSec;
        flow.lastEmitAt = now;
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
