// Grouped view: one route per (home airport, destination country) instead of
// one plane per flow. LAN and unknown-geo flights have no country to group by.

import type { Flight, HomeAirport } from '@/types';

export interface Route {
  key: string;
  home: HomeAirport;
  country: string;
  lat: number; // endpoint: the busiest flight's destination
  lng: number;
  count: number;
  bytes: number;
  bytesPerSec: number;
}

export function aggregateRoutes(flights: Flight[], homeAirports: HomeAirport[]): Route[] {
  const routes = new Map<string, Route>();
  const top = new Map<string, number>(); // bytes of each route's busiest flight
  for (const f of flights) {
    if (f.isLan || f.country === '??' || f.geoConfidence === 'none') continue;
    const home = homeAirports.find((a) => a.id === f.homeAirportId);
    if (!home) continue;
    const key = `${home.id}|${f.country}`;
    const r = routes.get(key);
    if (!r) {
      routes.set(key, {
        key,
        home,
        country: f.country,
        lat: f.dstLat,
        lng: f.dstLng,
        count: 1,
        bytes: f.bytesTotal,
        bytesPerSec: f.bytesPerSec,
      });
      top.set(key, f.bytesTotal);
      continue;
    }
    r.count++;
    r.bytes += f.bytesTotal;
    r.bytesPerSec += f.bytesPerSec;
    if (f.bytesTotal > top.get(key)!) {
      top.set(key, f.bytesTotal);
      r.lat = f.dstLat;
      r.lng = f.dstLng;
    }
  }
  return [...routes.values()];
}
