// src/lib/flight-pos.ts
// Where a plane is right now. One function for every consumer (2D markers, 3D
// meshes, 3D hit-testing, the anchored flight card, the leader line) so they
// all agree: LAN flights are pinned to home, the lifecycle pose adds its
// hold/orbit offset, and the 3D altitude follows the arc.

import type { Flight, HomeAirport } from '@/types';
import { flightEndpoints } from '@/lib/arc';
import { interpolateArc, greatCircleKm, arcAltitude } from '@/lib/interpolate';
import { lifecyclePose, type Pose } from '@/lib/lifecycle';
import { correctedLngOffset } from '@/lib/mesh-orientation';
import { liveProgress } from '@/lib/anim';

export interface FlightPos {
  lat: number; // plane position, pose offset included
  lng: number;
  alt: number; // globe altitude (fraction of radius)
  baseLat: number; // point on the arc (no pose offset): trail split point
  baseLng: number;
  heading: number;
  pose: Pose;
}

export function flightWorldPos(
  f: Flight,
  home: HomeAirport | undefined,
  now: number,
  progress = liveProgress(f),
): FlightPos {
  const ep = flightEndpoints(home, f);
  const lan = f.isLan && home;
  const base = lan
    ? { lat: home.lat, lng: home.lng, heading: 0 }
    : interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, progress);
  const km = lan ? 0 : greatCircleKm(ep.startLat, ep.startLng, ep.endLat, ep.endLng);
  const alt = lan ? 0.03 : arcAltitude(km) * Math.sin(progress * Math.PI) + 0.006;
  // The lng offset is widened by 1/cos(lat) so orbits stay round off the equator.
  const pose = lifecyclePose(f, now);
  return {
    lat: base.lat + pose.dLat,
    lng: base.lng + correctedLngOffset(pose.dLng, base.lat),
    alt,
    baseLat: base.lat,
    baseLng: base.lng,
    heading: base.heading,
    pose,
  };
}
