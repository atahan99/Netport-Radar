// src/lib/locate.ts
// Fly the active view (2D map or 3D globe) to a flight's current position.
// Shared by the Departures/Arrivals boards (click-to-locate) and the keyboard
// flight-stepping shortcut.

import { mapRef, globeRef } from '@/lib/view-refs';
import { flightEndpoints } from '@/lib/arc';
import { interpolateArc } from '@/lib/interpolate';
import { liveProgress } from '@/lib/anim';
import { reducedMotion } from '@/lib/motion';
import type { Flight, HomeAirport } from '@/types';

export function locateFlight(f: Flight, home: HomeAirport | undefined): void {
  const ep = flightEndpoints(home, f);
  const p = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, liveProgress(f));
  const ms = reducedMotion() ? 0 : 600;
  const map = mapRef.current;
  if (map) {
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 3.5), duration: ms });
    return;
  }
  globeRef.current?.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.6 }, ms);
}
