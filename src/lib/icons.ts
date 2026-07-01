// src/lib/icons.ts
// One SVG silhouette per aircraft type. 24×24 viewBox, centered at 12,12,
// nose pointing RIGHT (0°). Rotation is applied via CSS transform from heading.
// `mode` decides fill (solid silhouette) vs stroke (line art).
// Shapes follow the FlightRadar24 look: swept wings, tailplane, and per-type
// details (rotodome, rotor X, flying wing) drawn as top-down silhouettes.

import type { AircraftType } from '@/types';

export interface AircraftIcon {
  d: string;
  mode: 'fill' | 'stroke';
}

export const AIRCRAFT_ICONS: Record<AircraftType, AircraftIcon> = {
  // Twin-aisle airliner: long fuselage, swept wings, swept tailplane.
  widebody: {
    d: 'M23.2 12 C23.2 11.55 22.6 11.2 21.6 11.1 L15 10.75 L8.1 2.1 L6.7 2.1 L10.7 10.85 L6.1 11 L2.9 7.7 L1.9 7.7 L3.5 11.15 L2.1 11.35 L2.1 12.65 L3.5 12.85 L1.9 16.3 L2.9 16.3 L6.1 13 L10.7 13.15 L6.7 21.9 L8.1 21.9 L15 13.25 L21.6 12.9 C22.6 12.8 23.2 12.45 23.2 12 Z',
    mode: 'fill',
  },
  // Single-aisle jet: slimmer body, shorter swept wings.
  narrowbody: {
    d: 'M23 12 C23 11.6 22.5 11.35 21.6 11.3 L14.4 10.95 L9 4 L7.8 4 L10.5 11.05 L6 11.15 L3.4 8.6 L2.5 8.6 L3.9 11.3 L2.5 11.5 L2.5 12.5 L3.9 12.7 L2.5 15.4 L3.4 15.4 L6 12.85 L10.5 12.95 L7.8 20 L9 20 L14.4 13.05 L21.6 12.7 C22.5 12.65 23 12.4 23 12 Z',
    mode: 'fill',
  },
  // Heavy freighter: fat fuselage, long wings, oversized tail.
  cargo: {
    d: 'M22.6 12 C22.6 11.4 22 11 21 10.9 L15.4 10.55 L9.3 1.7 L7.6 1.7 L10.5 10.6 L6.1 10.75 L3.1 6.9 L1.9 6.9 L3.6 10.95 L2 11.2 L2 12.8 L3.6 13.05 L1.9 17.1 L3.1 17.1 L6.1 13.25 L10.5 13.4 L7.6 22.3 L9.3 22.3 L15.4 13.45 L21 13.1 C22 13 22.6 12.6 22.6 12 Z',
    mode: 'fill',
  },
  // Rotorcraft: cabin circle, rotor X, tail boom + tail rotor.
  helicopter: {
    d: 'M12.8 12 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M8.6 7.8 L17 16.2 M8.6 16.2 L17 7.8 M9.8 12 L3 12 M3 9.6 L3 14.4',
    mode: 'stroke',
  },
  // Business jet: sleek body, aft-set short wings, small tailplane.
  privatejet: {
    d: 'M23.2 12 C23.2 11.65 22.7 11.45 21.9 11.4 L13.6 11.05 L8.6 5.6 L7.6 5.6 L9.9 11.1 L5.4 11.2 L2.8 8.7 L2 8.7 L3.3 11.4 L2.3 11.6 L2.3 12.4 L3.3 12.6 L2 15.3 L2.8 15.3 L5.4 12.8 L9.9 12.9 L7.6 18.4 L8.6 18.4 L13.6 12.95 L21.9 12.6 C22.7 12.55 23.2 12.35 23.2 12 Z',
    mode: 'fill',
  },
  // Satellite: central bus + connectors + twin solar arrays.
  satellite: {
    d: 'M9.8 9.4 L14.2 9.4 L14.2 14.6 L9.8 14.6 Z M14.2 11.5 L16 11.5 L16 12.5 L14.2 12.5 Z M8 11.5 L9.8 11.5 L9.8 12.5 L8 12.5 Z M16 9.8 L22 9.8 L22 14.2 L16 14.2 Z M2 9.8 L8 9.8 L8 14.2 L2 14.2 Z',
    mode: 'fill',
  },
  // Quadcopter: diamond body + four rotor discs.
  drone: {
    d: 'M12 9.8 L14.2 12 L12 14.2 L9.8 12 Z M7.2 7.2 m-2.1 0 a2.1 2.1 0 1 0 4.2 0 a2.1 2.1 0 1 0 -4.2 0 M16.8 7.2 m-2.1 0 a2.1 2.1 0 1 0 4.2 0 a2.1 2.1 0 1 0 -4.2 0 M7.2 16.8 m-2.1 0 a2.1 2.1 0 1 0 4.2 0 a2.1 2.1 0 1 0 -4.2 0 M16.8 16.8 m-2.1 0 a2.1 2.1 0 1 0 4.2 0 a2.1 2.1 0 1 0 -4.2 0',
    mode: 'fill',
  },
  // Air ambulance: medical cross in a circle.
  ambulance: {
    d: 'M12 12 m-8.5 0 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0 M12 7 L12 17 M7 12 L17 12',
    mode: 'stroke',
  },
  // Flying wing (B-2 style) with sawtooth trailing edge.
  stealth: {
    d: 'M23 12 L8.6 3 L10.4 8.2 L4.6 5.8 L7.4 12 L4.6 18.2 L10.4 15.8 L8.6 21 Z',
    mode: 'fill',
  },
  // AWACS: airliner silhouette + rotodome over the aft fuselage.
  broadcast: {
    d: 'M23 12 C23 11.6 22.4 11.3 21.5 11.2 L14.8 10.85 L8.6 3.2 L7.2 3.2 L10.6 10.9 L6 11.05 L3.2 8.3 L2.3 8.3 L3.7 11.25 L2.3 11.45 L2.3 12.55 L3.7 12.75 L2.3 15.7 L3.2 15.7 L6 12.95 L10.6 13.1 L7.2 20.8 L8.6 20.8 L14.8 13.15 L21.5 12.8 C22.4 12.7 23 12.4 23 12 Z M10.2 12 m-3.4 0 a3.4 3.4 0 1 0 6.8 0 a3.4 3.4 0 1 0 -6.8 0',
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
  drone: 10,
  ambulance: 12,
  stealth: 16,
  broadcast: 16,
};
