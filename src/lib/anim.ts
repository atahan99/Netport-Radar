// src/lib/anim.ts
// Animation channel — per-frame mutable state read by the views' OWN rAF loops.
// React never subscribes to this. The Zustand flight store carries semantic
// state (which flights exist, phase, metrics, livery) at ~10Hz instead of every
// frame, so the HUD (boards, metrics, card) stops re-rendering 60–120×/sec.
// Smooth motion is preserved because the views read arcProgress from here each
// frame and reposition markers/meshes imperatively.

import type { Flight } from '@/types';
export { STORE_PUSH_MS } from '@/config';

// flightId → current arcProgress (0..1). Written by the live/demo rAF loop every
// frame; read by MapView, GlobeView, FlightCard, LeaderLine.
export const arcProgressLive = new Map<string, number>();

// Animated progress for a flight, falling back to the last snapshot value (e.g.
// a flight present in the store but not yet ticked, or after a tab regains focus).
export function liveProgress(f: Flight): number {
  return arcProgressLive.get(f.id) ?? f.arcProgress;
}
