// src/lib/map-recolor.ts
// Pure decision for how a theme recolors a dark-matter basemap paint property,
// by layer type. Extracted from MapView so it can be unit-tested without MapLibre.

import type { MapRecolor } from './themes';

// The theme color to apply for a given paint property + layer id, or undefined to
// keep the layer's original value (themes without a recolor, or props we leave
// alone). Water vs. land is distinguished by the layer id.
export function recolorValue(
  prop: string,
  layerId: string,
  rc: MapRecolor | undefined,
): string | undefined {
  if (!rc) return undefined;
  switch (prop) {
    case 'background-color':
      return rc.background;
    case 'fill-color':
      return layerId.includes('water') ? rc.water : rc.land;
    case 'line-color':
      return rc.line;
    case 'text-color':
      return rc.text;
    default:
      return undefined;
  }
}
