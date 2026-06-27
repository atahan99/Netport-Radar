// src/lib/lifecycle.ts
// Per-flight lifecycle pose: a small position offset (orbit) + scale + opacity
// driven by phase and a global clock. Used by MapView + GlobeView so flights
// spool at home, circle while holding, fade on touchdown, and LAN traffic orbits
// home instead of departing.

import type { Flight } from '@/types';

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
    return { dLat: 0, dLng: 0, scale: 0.85, opacity: 0.3 };
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
