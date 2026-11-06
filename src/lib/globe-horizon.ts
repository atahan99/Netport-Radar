// src/lib/globe-horizon.ts
// Is a ground point on the camera's side of the globe? Kept free of three.js so
// main-bundle components (flight card, leader line) can use it.
import type { GlobeApi } from './view-refs';

const GLOBE_R = 100; // react-globe.gl's globe radius

// > 0 in front of the horizon, < 0 behind it, scaled by R² (so 0.05 ≈ just
// past the limb). Returns 1 if the globe can't answer (keep things visible).
export function horizonMargin(g: GlobeApi, lat: number, lng: number): number {
  try {
    const P = g.getCoords(lat, lng, 0);
    const C = g.camera().position;
    return (P.x * C.x + P.y * C.y + P.z * C.z - GLOBE_R * GLOBE_R) / (GLOBE_R * GLOBE_R);
  } catch {
    return 1;
  }
}
