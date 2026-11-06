// src/lib/live-state.ts
// The live client's flight list and how server messages change it. Kept apart
// from the WebSocket/rAF wiring in live.ts so it can be tested directly.
// Everything arriving over the socket is treated as untrusted input.

import type { Flight, FlightEvent, ServerMessage } from '@/types';

export interface LiveFlight extends Flight {
  phaseStartedAt: number; // client clock (performance.now) when current phase began
  cruiseBase: number; // arcProgress when cruise/descent began (for resume)
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// The fields the views read without null checks. A flight missing any of them
// would throw inside a render or rAF loop.
export function isFlight(v: unknown): v is Flight {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.process) &&
    isStr(v.hostname) &&
    isStr(v.phase) &&
    isStr(v.homeAirportId) &&
    isStr(v.liveryColor) &&
    isStr(v.aircraftType) &&
    isStr(v.detectedProtocol) &&
    isStr(v.country) &&
    isNum(v.dstLat) &&
    isNum(v.dstLng) &&
    isNum(v.bytesTotal) &&
    isNum(v.arcProgress) &&
    typeof v.isLan === 'boolean'
  );
}

// Shape check only — per-event fields are checked in apply().
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isStr(raw)) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || !isStr(v.type)) return null;
  switch (v.type) {
    case 'init':
      return Array.isArray(v.homeAirports) && isObj(v.backend) && Array.isArray(v.flights)
        ? (v as unknown as ServerMessage)
        : null;
    case 'home_update':
      return Array.isArray(v.homeAirports) ? (v as unknown as ServerMessage) : null;
    case 'batch':
      return Array.isArray(v.events) ? (v as unknown as ServerMessage) : null;
    case 'reset':
      return { type: 'reset' };
    case 'log':
      return isStr(v.ndjson) ? (v as unknown as ServerMessage) : null;
    case 'error':
      return isStr(v.code) && isStr(v.message) ? (v as unknown as ServerMessage) : null;
    default:
      return null;
  }
}

// Copy only fields the flight already has, with the same primitive type.
// Object.hasOwn rejects __proto__/constructor, so a patch can't pollute.
function applyPatch(lf: LiveFlight, patch: unknown): void {
  if (!isObj(patch)) return;
  const target = lf as unknown as Record<string, unknown>;
  for (const [k, val] of Object.entries(patch)) {
    if (k === 'id' || !Object.hasOwn(target, k)) continue;
    if (typeof val === typeof target[k]) target[k] = val;
  }
}

export class LiveState {
  readonly flights: LiveFlight[] = [];
  readonly byId = new Map<string, LiveFlight>();

  // Replace everything with the server's snapshot (init).
  seed(snapshot: unknown[], now: number): void {
    this.clear();
    for (const f of snapshot) {
      if (isFlight(f)) this.add(f, now);
    }
  }

  clear(): void {
    this.flights.length = 0;
    this.byId.clear();
  }

  remove(index: number): LiveFlight {
    const [lf] = this.flights.splice(index, 1);
    this.byId.delete(lf.id);
    return lf;
  }

  // Returns true when the change should reach the views immediately
  // (membership or phase), false for metric-only updates.
  apply(e: FlightEvent, now: number): boolean {
    if (!isObj(e)) return false;
    if (e.event === 'opened') {
      if (!isFlight(e.flight)) return false;
      const existing = this.byId.get(e.flight.id);
      if (existing) {
        // Snapshot + a batch queued before it can both carry the same flight.
        applyPatch(existing, e.flight);
        return true;
      }
      this.add(e.flight, now);
      return true;
    }
    if (!isStr(e.id)) return false;
    const lf = this.byId.get(e.id);
    if (!lf) return false;
    if (e.event === 'updated') {
      applyPatch(lf, e.patch);
      return false;
    }
    if (e.event === 'hostname') {
      if (!isStr(e.hostname)) return false;
      lf.hostname = e.hostname;
      if (isStr(e.sni)) lf.sni = e.sni;
      return false;
    }
    if (e.event === 'phase') {
      if (!isStr(e.phase)) return false;
      const changed = lf.phase !== e.phase;
      if (changed) {
        lf.phaseStartedAt = now;
        lf.cruiseBase = lf.arcProgress;
      }
      lf.phase = e.phase;
      return changed;
    }
    if (e.event === 'closed') {
      if (isNum(e.bytesTotal)) lf.bytesTotal = e.bytesTotal;
      if (isNum(e.durationMs)) lf.durationMs = e.durationMs;
      lf.landedAt = Date.now();
      if (lf.phase !== 'landed') {
        lf.phase = 'landed';
        lf.phaseStartedAt = now;
        return true;
      }
    }
    return false;
  }

  private add(f: Flight, now: number): void {
    const lf: LiveFlight = { ...f, phaseStartedAt: now, cruiseBase: f.arcProgress };
    this.byId.set(lf.id, lf);
    this.flights.push(lf);
  }
}
