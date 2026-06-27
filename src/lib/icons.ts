// src/lib/icons.ts
// One SVG silhouette per aircraft type. 24×24 viewBox, centered at 12,12,
// nose pointing RIGHT (0°). Rotation is applied via CSS transform from heading.
// `mode` decides fill (solid silhouette) vs stroke (line art).

import type { AircraftType } from '@/types';

export interface AircraftIcon {
  d: string;
  mode: 'fill' | 'stroke';
}

export const AIRCRAFT_ICONS: Record<AircraftType, AircraftIcon> = {
  widebody: {
    d: 'M23 12 L13 9 L13 4 L10 4 L10 9 L4 11 L2 11 L2 13 L4 13 L10 15 L10 20 L13 20 L13 15 Z',
    mode: 'fill',
  },
  narrowbody: {
    d: 'M23 12 L14.5 10 L14.5 6 L11.5 6 L11.5 10 L5 11.4 L3 11.4 L3 12.6 L5 12.6 L11.5 14 L11.5 18 L14.5 18 L14.5 14 Z',
    mode: 'fill',
  },
  cargo: {
    d: 'M21 9 L21 15 L8 15 L8 20 L5 20 L5 15 L2 13.5 L2 10.5 L5 9 L5 4 L8 4 L8 9 Z',
    mode: 'fill',
  },
  helicopter: {
    d: 'M12 2.5 L12 21.5 M2.5 12 L21.5 12 M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
    mode: 'stroke',
  },
  privatejet: {
    d: 'M23 12 L7 9 L3 5 L6.5 11 L2 12 L6.5 13 L3 19 L7 15 Z',
    mode: 'fill',
  },
  satellite: {
    d: 'M2 11 L22 11 L22 13 L2 13 Z M8.5 4 L15.5 4 L15.5 9 L8.5 9 Z M8.5 15 L15.5 15 L15.5 20 L8.5 20 Z',
    mode: 'fill',
  },
  drone: {
    d: 'M12 12 m-3.5 0 a3.5 3.5 0 1 0 7 0 a3.5 3.5 0 1 0 -7 0',
    mode: 'fill',
  },
  ambulance: {
    d: 'M12 5 L12 19 M5 12 L19 12',
    mode: 'stroke',
  },
  stealth: {
    d: 'M23 12 L4 4.5 L9.5 12 L4 19.5 Z',
    mode: 'fill',
  },
  broadcast: {
    d: 'M3 9 L19 9 L19 15 L3 15 Z M11 3.5 a2.6 2.6 0 1 0 0.01 0',
    mode: 'fill',
  },
};

// On-screen pixel size per type (2D map markers).
export const AIRCRAFT_SIZE: Record<AircraftType, number> = {
  widebody: 20,
  narrowbody: 16,
  cargo: 20,
  helicopter: 16,
  privatejet: 16,
  satellite: 16,
  drone: 8,
  ambulance: 12,
  stealth: 16,
  broadcast: 16,
};
