// src/lib/themes.ts
// Color themes for the 2D map, 3D globe, and HUD accent.
//
// 2D map: most themes share the Carto dark-matter vector style and genuinely
// recolor its layers (background/water/land/lines/labels) via MapLibre paint
// overrides — a real green/amber/blue map, not a CSS tint. "Arctic" swaps to the
// light Positron style and "Satellite" swaps to real Esri World Imagery raster.
// 3D globe: per-theme earth texture + tint + atmosphere glow. Planes keep livery.

import type { StyleSpecification } from 'maplibre-gl';

export type ThemeName =
  | 'midnight'
  | 'matrix'
  | 'cyberpunk'
  | 'amber'
  | 'blueprint'
  | 'arctic'
  | 'satellite'
  | 'night';

// Per-layer recolor applied by layer type to the dark-matter style.
export interface MapRecolor {
  background: string;
  water: string;
  land: string;
  line: string;
  text: string;
}

export interface Theme {
  id: ThemeName;
  label: string;
  accent: string; // HUD accent (--theme-accent)
  atmosphere: string; // globe atmosphere glow
  atmosphereAlt?: number; // atmosphere thickness (default 0.16)
  globeTint: string; // multiplies the earth texture (white = untinted)
  globeImageUrl: string; // earth texture
  // Two-color recolor of the 3D globe surface: the earth texture's luminance
  // is remapped to these land/water colors in the fragment shader
  // (lib/globe-material.ts), mirroring the 2D map recolor. Absent = realistic
  // photo texture (Satellite).
  globeLand?: string;
  globeWater?: string;
  globeBorder?: string; // globe country borders (else falls back to mapRecolor.line ?? accent)
  bg: string; // app background
  mapStyle: string | StyleSpecification; // 2D base style
  mapRecolor?: MapRecolor; // optional dark-base recolor (absent = native colors)
  // Light basemap: HUD panels switch to light surfaces (see index.css).
  light?: boolean;
}

const DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// Real-Earth raster (Esri World Imagery — public, no key).
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/fonts/{fontstack}/{range}.pbf',
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
};

const EARTH_DARK = '/textures/earth-dark.jpg';
const EARTH_BLUE = '/textures/earth-blue-marble.jpg';
const EARTH_NIGHT = '/textures/earth-night.jpg'; // NASA Black Marble (public domain)

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    accent: '#4285F4',
    atmosphere: '#3a82ff',
    globeTint: '#ffffff',
    globeImageUrl: EARTH_DARK,
    // Exact Carto dark-matter palette (2D basemap): near-black land, gray-blue
    // water, the style's country-boundary gray. The globe IS the 2D map.
    globeLand: '#0e0e0e',
    globeWater: '#2c353c',
    globeBorder: '#666666',
    bg: '#000000',
    mapStyle: DARK,
  },
  {
    id: 'matrix',
    label: 'Matrix',
    accent: '#28ff8e',
    atmosphere: '#00ff66',
    globeTint: '#4dff9e',
    globeImageUrl: EARTH_DARK,
    // Same palette as the 2D recolor below: continents = background, oceans =
    // water, borders = line (via the globeBorderColor fallback).
    globeLand: '#072a17',
    globeWater: '#00110b',
    bg: '#000a04',
    mapStyle: DARK,
    // background = continents (at world zoom the visible "land" is the basemap
    // background layer); water = oceans. Keep continents a clear notch brighter
    // than oceans so landmasses read as shapes, with line/text bright on top.
    mapRecolor: { background: '#072a17', water: '#00110b', land: '#0a3a20', line: '#00c853', text: '#54ff9a' },
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    accent: '#ff3cac',
    atmosphere: '#ff2bd6',
    atmosphereAlt: 0.2,
    globeTint: '#ff86e2',
    globeImageUrl: EARTH_DARK,
    globeLand: '#1c0a3a',
    globeWater: '#0a0018',
    bg: '#0a0016',
    mapStyle: DARK,
    mapRecolor: { background: '#1c0a3a', water: '#0a0018', land: '#24114a', line: '#ff45b0', text: '#46ecff' },
  },
  {
    id: 'amber',
    label: 'Amber CRT',
    accent: '#ffb000',
    atmosphere: '#ffb000',
    globeTint: '#ffcf73',
    globeImageUrl: EARTH_DARK,
    globeLand: '#2a1800',
    globeWater: '#0c0600',
    bg: '#0a0600',
    mapStyle: DARK,
    mapRecolor: { background: '#2a1800', water: '#0c0600', land: '#352000', line: '#e09600', text: '#ffd166' },
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    accent: '#4d9fff',
    atmosphere: '#1e6fff',
    globeTint: '#74a8ff',
    globeImageUrl: EARTH_DARK,
    globeLand: '#0c2147',
    globeWater: '#00163a',
    bg: '#00040d',
    mapStyle: DARK,
    mapRecolor: { background: '#0c2147', water: '#00163a', land: '#0e2a55', line: '#4a90ff', text: '#9cc4ff' },
  },
  {
    id: 'arctic',
    label: 'Arctic',
    light: true,
    accent: '#0ea5e9',
    atmosphere: '#aee3ff',
    atmosphereAlt: 0.12,
    globeTint: '#dff0ff',
    globeImageUrl: EARTH_DARK,
    // Exact Carto Positron palette (2D basemap): near-white land, pale
    // blue-gray water, neutral gray borders.
    globeLand: '#fafaf8',
    globeWater: '#d4dadc',
    globeBorder: '#9aa0a6',
    bg: '#0a1118',
    mapStyle: POSITRON, // real light basemap
  },
  {
    id: 'satellite',
    label: 'Satellite',
    accent: '#7dd3fc',
    atmosphere: '#6fb7ff',
    globeTint: '#ffffff',
    globeImageUrl: EARTH_BLUE, // real NASA blue-marble earth
    bg: '#01030a',
    mapStyle: SATELLITE_STYLE, // real Esri imagery
  },
  {
    id: 'night',
    label: 'Night',
    accent: '#ffb347',
    atmosphere: '#6fa8ff',
    globeTint: '#ffffff',
    globeImageUrl: EARTH_NIGHT, // city lights; photo path (no land/water remap)
    bg: '#000000',
    mapStyle: DARK, // no night-lights vector basemap: 2D matches Midnight
  },
];

export const THEME_BY_ID: Record<ThemeName, Theme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
) as Record<ThemeName, Theme>;

export function applyTheme(name: ThemeName): void {
  const t = THEME_BY_ID[name] ?? THEME_BY_ID.midnight;
  const r = document.documentElement;
  r.dataset.theme = t.id;
  r.style.setProperty('--theme-accent', t.accent);
  r.style.setProperty('--theme-bg', t.bg);
  r.dataset.themeMode = t.light ? 'light' : 'dark';
  r.style.colorScheme = t.light ? 'light' : 'dark';
}
