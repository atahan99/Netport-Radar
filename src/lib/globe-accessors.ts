// src/lib/globe-accessors.ts
// react-globe.gl data accessors that depend only on their datum. Module-level
// so their identity never changes: a new accessor function makes the library
// rebuild that layer.

import type { Flight, HomeAirport } from '@/types';
import { useFiltersStore } from '@/store/filters';
import { useFlightsStore } from '@/store/flights';
import { trailWidth } from './trail-width';
import { homeRingColor, polygonCapColor, polygonSideColor } from './globe-color';

export interface DestDot {
  country: string;
  lat: number;
  lng: number;
  count: number;
}

// Trail entry: a flight, or the selected flight's remaining (estimated) route.
export type TrailDatum = Flight & { __remaining?: boolean };

export const asF = (d: object) => d as Flight;

export const pathPointAlt = (p: unknown) => (p as number[])[2];
// Busier flows draw thicker (trailWidth). Reads the selection from the store
// so the accessor keeps one identity; GlobeView's trail signature includes
// the bucketed width, so a change rebuilds the paths.
export const pathStroke = (d: object) => {
  const t = d as TrailDatum;
  if (t.__remaining) return 1.1;
  return 1.6 * trailWidth(t.bytesPerSec, t.id === useFlightsStore.getState().selectedFlightId);
};

export const ringLat = (d: object) => (d as HomeAirport).lat;
export const ringLng = (d: object) => (d as HomeAirport).lng;
export const ringColor = (d: object) => () =>
  (d as { __color?: string }).__color ?? homeRingColor((d as HomeAirport).isVpn);

// three-globe's label font only has ASCII glyphs ("Zürich" rendered as "Z?rich"),
// so fold accents for the 3D labels. The 2D map keeps the original text.
export const asciiLabel = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const labelText = (d: object) => asciiLabel((d as HomeAirport).label);
export const labelColor = (d: object) => homeRingColor((d as HomeAirport).isVpn);

export const pointLat = (d: object) => (d as DestDot).lat;
export const pointLng = (d: object) => (d as DestDot).lng;
export const pointRadius = (d: object) => 0.18 + Math.min(0.35, (d as DestDot).count * 0.03);
export const pointColor = () => 'rgba(255,255,255,0.55)';
export const onPointClick = (d: object) =>
  useFiltersStore.getState().setIsolatedCountry((d as DestDot).country);

export const polygonCapColorFn = () => polygonCapColor();
export const polygonSideColorFn = () => polygonSideColor();
