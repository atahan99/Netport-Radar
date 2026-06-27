// src/lib/view-refs.ts
// Module singletons that expose the live map / globe instances so the
// FlightCard can anchor to a moving plane without prop drilling.

import type { Map as MlMap } from 'maplibre-gl';

export interface GlobeApi {
  getScreenCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number };
  getCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number; z: number };
  camera: () => { position: { x: number; y: number; z: number } };
}

export const mapRef: { current: MlMap | null } = { current: null };
export const globeRef: { current: GlobeApi | null } = { current: null };
