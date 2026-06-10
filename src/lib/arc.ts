// src/lib/arc.ts
// Resolve the arc endpoints for a flight given its home airport.
// Outbound: home → remote. Inbound: remote → home (so the plane ARRIVES home).

import type { Flight, HomeAirport } from '@/types';

export interface Endpoints {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export function flightEndpoints(home: HomeAirport | undefined, f: Flight): Endpoints {
  const hLat = home?.lat ?? 0;
  const hLng = home?.lng ?? 0;
  return f.direction === 'inbound'
    ? { startLat: f.dstLat, startLng: f.dstLng, endLat: hLat, endLng: hLng }
    : { startLat: hLat, startLng: hLng, endLat: f.dstLat, endLng: f.dstLng };
}
