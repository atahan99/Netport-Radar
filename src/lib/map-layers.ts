// src/lib/map-layers.ts
// The 2D map's own GeoJSON sources and layers (trails, selected route,
// destination markers). setStyle (theme swap) drops custom layers, so MapView
// calls this after every style load; it's idempotent.

import type maplibregl from 'maplibre-gl';

export function addFlightOverlay(map: maplibregl.Map): void {
  if (map.getSource('arcs')) return;
  map.addSource('arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('dests', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Selected flight's remaining route: thin dotted line under the trails.
  map.addLayer({
    id: 'route-remaining',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.2,
      'line-opacity': 0.55,
      'line-dasharray': [0.6, 2],
    },
  });
  map.addLayer({
    id: 'arcs-solid',
    type: 'line',
    source: 'arcs',
    filter: ['==', ['get', 'vpn'], false],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.4],
      'line-opacity': ['get', 'op'],
    },
  });
  map.addLayer({
    id: 'arcs-vpn',
    type: 'line',
    source: 'arcs',
    filter: ['==', ['get', 'vpn'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.4],
      'line-opacity': ['get', 'op'],
      'line-dasharray': [2, 2],
    },
  });
  // FR24-style airport markers: outer ring + inner dot, sized by flight count.
  map.addLayer({
    id: 'dests-ring',
    type: 'circle',
    source: 'dests',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 5, 20, 9],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': 'rgba(255,255,255,0.35)',
      'circle-stroke-width': 1.2,
    },
  });
  map.addLayer({
    id: 'dests',
    type: 'circle',
    source: 'dests',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 2.5, 20, 4.5],
      'circle-color': 'rgba(255,255,255,0.9)',
      'circle-stroke-color': 'rgba(0,0,0,0.4)',
      'circle-stroke-width': 1,
    },
  });
}
