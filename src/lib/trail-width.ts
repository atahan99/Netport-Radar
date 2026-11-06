// src/lib/trail-width.ts
// Trail width multiplier: busier flows draw thicker, the selected flight
// thicker still. Log scale so one huge download doesn't dwarf everything, and
// rounded to 0.1 so the views' change signatures only move on visible steps.
export function trailWidth(bytesPerSec: number, selected: boolean): number {
  const bps = Number.isFinite(bytesPerSec) ? Math.max(0, bytesPerSec) : 0;
  const w = Math.min(2.2, 1 + Math.log10(1 + bps / 50_000));
  return Math.round(w * (selected ? 1.6 : 1) * 10) / 10;
}
