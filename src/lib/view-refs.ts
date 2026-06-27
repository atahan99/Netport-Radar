// src/lib/view-refs.ts
// Module singletons exposing the live map / globe instances so off-view code
// (FlightCard, LeaderLine) can project lat/lng → screen without prop drilling.
//
// Contract: exactly one MapView and one GlobeView are mounted at a time (the
// App swaps them by viewMode). Each sets its ref on mount and nulls it on
// unmount. Readers MUST null-check `.current` and only call inside rAF loops /
// event handlers — never during React render (these are imperative escape
// hatches, not reactive state).

import type { Map as MlMap } from 'maplibre-gl';

export interface GlobeApi {
  getScreenCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number };
  getCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number; z: number };
  camera: () => { position: { x: number; y: number; z: number } };
  pointOfView: (coords: { lat: number; lng: number; altitude?: number }, ms?: number) => void;
}

export const mapRef: { current: MlMap | null } = { current: null };
export const globeRef: { current: GlobeApi | null } = { current: null };
// Docked flight card — LeaderLine reads getBoundingClientRect for its endpoint.
export const flightCardRef: { current: HTMLDivElement | null } = { current: null };
