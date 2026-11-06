// src/lib/map-theme.ts
// Applying a theme to the dark-matter basemap at the MapLibre paint level.
// The per-property color decision is the pure recolorValue (map-recolor.ts).

import type maplibregl from 'maplibre-gl';
import type { Theme } from './themes';
import { recolorValue } from './map-recolor';

export type PaintSnap = { prop: string; value: unknown };

// Genuinely recolor the dark-matter vector layers per theme (by layer type), or
// restore the captured originals when the theme has no recolor (Midnight/Positron).
export function recolorMap(map: maplibregl.Map, snaps: Map<string, PaintSnap>, theme: Theme): void {
  for (const [id, snap] of snaps) {
    const val = recolorValue(snap.prop, id, theme.mapRecolor) ?? snap.value;
    try {
      map.setPaintProperty(id, snap.prop, val as string);
    } catch {
      /* layer/prop gone after a style swap — ignore */
    }
  }
}

export function snapshotPaint(map: maplibregl.Map): Map<string, PaintSnap> {
  const snaps = new Map<string, PaintSnap>();
  for (const layer of map.getStyle().layers ?? []) {
    const prop =
      layer.type === 'background'
        ? 'background-color'
        : layer.type === 'fill'
          ? 'fill-color'
          : layer.type === 'line'
            ? 'line-color'
            : layer.type === 'symbol'
              ? 'text-color'
              : null;
    if (prop) {
      try {
        snaps.set(layer.id, { prop, value: map.getPaintProperty(layer.id, prop) });
      } catch {
        /* ignore */
      }
    }
  }
  return snaps;
}
