// src/lib/render-queue.ts
// Decides which flights actually render. Main pool 150, DNS pool 20 (separate).
// Bump priority (keep highest): descent > cruise > taxi > hold > landed.

import type { Flight, FlightPhase } from '@/types';
import type { FilterState } from '@/store/filters';
import { protocolFamily } from './classify';
import { MAIN_CAP, DNS_CAP } from '@/config';

const PHASE_PRIORITY: Record<FlightPhase, number> = {
  descent: 5,
  cruise: 4,
  taxi: 3,
  hold: 2,
  landed: 1,
};

function matchesProtocolFilters(f: Flight, filters: FilterState): boolean {
  switch (protocolFamily(f.detectedProtocol)) {
    case 'vpn':
      return filters.showVPN;
    case 'dns':
      return filters.showDNS;
    case 'stream':
      return filters.showStreaming;
    case 'gaming':
      return filters.showGaming;
    case 'ssh':
      return filters.showSSH;
    case 'quic':
      return filters.showQUIC;
    case 'http':
      return filters.showHTTP;
    case 'https':
      return filters.showHTTPS;
    case 'icmp':
      return filters.showICMP;
    case 'udp':
      return filters.showUDP;
    default:
      return true; // raw TCP and anything else
  }
}

export function passesFilters(f: Flight, filters: FilterState): boolean {
  if (!matchesProtocolFilters(f, filters)) return false;
  if (f.isLan && !filters.showLAN) return false;
  if (f.isIPv6 && !filters.showIPv6) return false;
  if (filters.direction !== 'both' && f.direction !== filters.direction) return false;
  if (
    filters.appSearch &&
    !f.process.toLowerCase().includes(filters.appSearch.toLowerCase())
  )
    return false;
  if (filters.isolatedCountry && f.country !== filters.isolatedCountry) return false;
  if (filters.airportFilter === 'primary' && f.homeAirportId !== 'primary') return false;
  if (filters.airportFilter === 'vpn' && f.homeAirportId === 'primary') return false;
  return true;
}

function byPriority(a: Flight, b: Flight): number {
  const pd = PHASE_PRIORITY[b.phase] - PHASE_PRIORITY[a.phase];
  if (pd !== 0) return pd;
  return b.startedAt - a.startedAt; // newer first
}

export interface RenderQueue {
  mainQueue: Flight[];
  dnsQueue: Flight[];
  offScreenCount: number;
}

// Ref-equality memo. The flight array changes only at the 10Hz store cadence
// now, but MapView's and GlobeView's per-frame loops (plus MetricsStrip) all
// want the queue — without this the filter + double-sort would run several times
// per frame. Single-entry is enough: every caller reads the same two store refs.
let lastFlights: Flight[] | null = null;
let lastFilters: FilterState | null = null;
let lastResult: RenderQueue | null = null;
export function getRenderQueueMemo(flights: Flight[], filters: FilterState): RenderQueue {
  if (flights === lastFlights && filters === lastFilters && lastResult) return lastResult;
  lastFlights = flights;
  lastFilters = filters;
  lastResult = getRenderQueue(flights, filters);
  return lastResult;
}

export function getRenderQueue(flights: Flight[], filters: FilterState): RenderQueue {
  const mainEligible: Flight[] = [];
  let dnsEligible: Flight[] = [];

  for (const f of flights) {
    if (!passesFilters(f, filters)) continue;
    if (f.aircraftType === 'drone') dnsEligible.push(f);
    else mainEligible.push(f);
  }

  // DNS density applies inside the queue, before the 20-slot cap.
  if (filters.dnsDensity === 'none') {
    dnsEligible = [];
  } else if (filters.dnsDensity === 'sample') {
    dnsEligible = dnsEligible.filter((f) => f.startedAt % 10 === 0);
  }

  mainEligible.sort(byPriority);
  dnsEligible.sort(byPriority);

  const mainQueue = mainEligible.slice(0, MAIN_CAP);
  const dnsQueue = dnsEligible.slice(0, DNS_CAP);

  const offScreenCount =
    Math.max(0, mainEligible.length - MAIN_CAP) +
    Math.max(0, dnsEligible.length - DNS_CAP);

  return { mainQueue, dnsQueue, offScreenCount };
}
