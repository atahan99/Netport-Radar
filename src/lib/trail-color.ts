// src/lib/trail-color.ts
// Trail coloring shared by the 2D map and 3D globe. Two styles:
//  - 'livery': the trail carries the plane's app color (default).
//  - 'altitude': FR24's rainbow — color encodes the altitude profile at that
//    point of the arc (warm near the ground, cool at cruise apex).

import { rgba } from '@/lib/globe-color';

export type TrailStyle = 'livery' | 'altitude';

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** FR24 altitude ramp: 0 = ground (amber) → 1 = cruise apex (blue-violet). */
export function altitudeHex(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  return hslToHex(45 + k * 215, 85, 55);
}

/** Altitude fraction (0..1) at arc-progress `t` — matches the arc's sin profile. */
export function altitudeAt(t: number): number {
  return Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
}

/** Color for 2D trail segment `seg` of `segs` (trail spans arc progress 0..prog). */
export function trailSegmentColor(
  liveryColor: string,
  seg: number,
  segs: number,
  prog: number,
  style: TrailStyle,
): string {
  if (style !== 'altitude') return liveryColor;
  return altitudeHex(altitudeAt(((seg + 0.5) / segs) * prog));
}

/** Per-point rgba colors for a 3D trail (steps+1 points, quadratic alpha ramp
 * toward the plane, hue by style). */
export function trailPathColors(
  liveryColor: string,
  steps: number,
  prog: number,
  style: TrailStyle,
): string[] {
  const n = steps + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const color = style === 'altitude' ? altitudeHex(altitudeAt(t * prog)) : liveryColor;
    out.push(rgba(color, t * t * 0.9));
  }
  return out;
}
