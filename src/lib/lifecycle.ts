// src/lib/lifecycle.ts
// Per-flight lifecycle pose: a small position offset (orbit) + scale + opacity
// driven by phase and a global clock. Used by MapView + GlobeView so flights
// spool at home, circle while holding, fade on touchdown, and LAN traffic orbits
// home instead of departing.

import type { Flight } from '@/types';
import { reducedMotion } from '@/lib/motion';

export interface Pose {
  dLat: number; // degrees offset added to the base position
  dLng: number;
  scale: number;
  opacity: number;
}

const TAU = Math.PI * 2;

// Deterministic per-flight angle so orbiting planes spread out instead of stacking.
function phaseOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * TAU;
}

function orbit(
  t: number,
  period: number,
  rLat: number,
  rLng: number,
  off: number,
): { dLat: number; dLng: number } {
  const a = (t / period) * TAU + off;
  return { dLat: rLat * Math.sin(a), dLng: rLng * Math.cos(a) };
}

export function lifecyclePose(f: Flight, t: number): Pose {
  if (f.phase === 'landed') {
    // Ease the touchdown shrink+fade over ~400ms instead of snapping. Flights
    // without a landedAt timestamp (or under reduced motion) get the final pose.
    if (f.landedAt !== undefined && !reducedMotion()) {
      const k = Math.min(1, Math.max(0, (Date.now() - f.landedAt) / 400));
      const e = 1 - (1 - k) * (1 - k); // ease-out
      return { dLat: 0, dLng: 0, scale: 1 - 0.15 * e, opacity: 1 - 0.7 * e };
    }
    return { dLat: 0, dLng: 0, scale: 0.85, opacity: 0.3 };
  }
  // Reduced motion: no orbit / no spool pulse — a static plane (LAN keeps its
  // dimmer opacity so it stays visually distinct). Arc travel itself remains.
  if (reducedMotion()) {
    return { dLat: 0, dLng: 0, scale: 1, opacity: f.isLan ? 0.9 : 1 };
  }
  const off = phaseOffset(f.id);
  if (f.isLan) {
    // LAN: slow orbit around home, never departs.
    return { ...orbit(t, 11000, 1.6, 2.6, off), scale: 1, opacity: 0.9 };
  }
  if (f.phase === 'hold') {
    // Hold: tighter, quicker circle near the destination.
    return { ...orbit(t, 6000, 1.2, 2.0, off), scale: 1, opacity: 1 };
  }
  if (f.phase === 'taxi') {
    // Taxi spool: gentle pulse at the home airport.
    const p = 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(t / 300 + off));
    return { dLat: 0, dLng: 0, scale: p, opacity: 0.55 + 0.45 * p };
  }
  return { dLat: 0, dLng: 0, scale: 1, opacity: 1 };
}
