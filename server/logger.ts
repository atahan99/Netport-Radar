// server/logger.ts
// In-memory NDJSON session log — one line per FlightEvent (everything the flow
// tracker emits, including short-lived/filtered flights the client never renders).
// Exported on demand and reset when the interface is switched.

import type { FlightEvent } from '../src/types';

const lines: string[] = [];
const MAX = 200_000;

export function logEvent(e: FlightEvent): void {
  let obj: Record<string, unknown> | null = null;
  if (e.event === 'opened') {
    const f = e.flight;
    obj = {
      t: f.startedAt,
      e: 'opened',
      id: f.id,
      process: f.process,
      pid: f.pid,
      proto: f.detectedProtocol,
      src: `${f.srcIp}:${f.srcPort}`,
      dst: `${f.dstIp}:${f.dstPort}`,
      country: f.country,
      city: f.city,
      org: f.org,
      hostname: f.hostname,
      aircraft: f.aircraftType,
      homeAirport: f.homeAirportId,
      isLan: f.isLan,
      isIPv6: f.isIPv6,
    };
  } else if (e.event === 'phase') {
    obj = { t: Date.now(), e: 'phase', id: e.id, phase: e.phase };
  } else if (e.event === 'hostname') {
    obj = { t: Date.now(), e: 'hostname', id: e.id, hostname: e.hostname, sni: e.sni };
  } else if (e.event === 'closed') {
    obj = { t: Date.now(), e: 'closed', id: e.id, bytesTotal: e.bytesTotal, durationMs: e.durationMs };
  }
  // 'updated' patches are too chatty for the log — skipped.
  if (!obj) return;
  lines.push(JSON.stringify(obj));
  if (lines.length > MAX) lines.splice(0, MAX / 2);
}

export function exportNdjson(): string {
  return lines.join('\n');
}

export function resetLog(): void {
  lines.length = 0;
}
