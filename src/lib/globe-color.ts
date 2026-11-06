// src/lib/globe-color.ts
// Pure globe surface / polygon color decisions extracted from GlobeView.

import type { Theme } from '@/lib/themes';

export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a.toFixed(3)})`;
}

/** Flat ocean texture for themed vector globes (react-globe.gl needs a real URL). */
export function solidGlobeTexture(hex: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${hex}"/></svg>`,
  )}`;
}

/** Resolve the globe surface image URL for a theme. */
export function resolveGlobeImage(theme: Theme): string {
  return theme.globeWater ? solidGlobeTexture(theme.globeWater) : theme.globeImageUrl;
}

/** Border stroke color for themed country polygons. */
export function globeBorderColor(theme: Theme): string {
  return theme.globeBorder ?? theme.mapRecolor?.line ?? theme.accent;
}

/** Whether the theme draws vector country polygons on the globe. */
export function useVectorPolygons(theme: Theme): boolean {
  return !!theme.globeLand;
}

// Caps are fully transparent: the land itself comes from the shader-recolored
// earth texture (lib/globe-material.ts); polygons only contribute border strokes.
export function polygonCapColor(): string {
  return 'rgba(0,0,0,0)';
}

export function polygonSideColor(): string {
  return 'rgba(0,0,0,0)';
}

// Border strokes fade as the camera pulls back: thin near-white lines over a
// whole hemisphere read as noise.
export function polygonStrokeColor(borderColor: string, alpha = 1): string {
  return alpha >= 1 || !borderColor.startsWith('#') ? borderColor : rgba(borderColor, alpha);
}

// Altitude (camera distance in globe radii) → border alpha, bucketed so the
// polygon layer only recolors on visible steps.
export function borderAlphaForAltitude(altitude: number): number {
  const a = Math.min(1, Math.max(0.25, 1.35 - 0.35 * altitude));
  return Math.round(a * 4) / 4;
}

/** Home-airport ring color factory (VPN = purple, else white). */
export function homeRingColor(isVpn: boolean): string {
  return isVpn ? '#a78bfa' : '#ffffff'; // violet-400: readable on the dark globe
}

/** Gradient trail colors along an arc path — quadratic ramp so the trail
 * stays faint near the origin and brightens sharply toward the plane. */
export function pathGradientColors(liveryColor: string, steps: number): string[] {
  const n = steps + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(rgba(liveryColor, t * t * 0.9));
  }
  return out;
}
