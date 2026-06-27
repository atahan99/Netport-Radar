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
  | 'satellite';

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
  globeTint: string; // multiplies the earth texture (white = untinted)
  globeImageUrl: string; // earth texture
  bg: string; // app background
  mapStyle: string | StyleSpecification; // 2D base style
  mapRecolor?: MapRecolor; // optional dark-base recolor (absent = native colors)
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

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    accent: '#4285F4',
    atmosphere: '#3a82ff',
    globeTint: '#ffffff',
    globeImageUrl: EARTH_DARK,
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
    bg: '#000a04',
    mapStyle: DARK,
    mapRecolor: { background: '#000a04', water: '#00130b', land: '#001509', line: '#00b34d', text: '#3dff8b' },
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    accent: '#ff3cac',
    atmosphere: '#ff2bd6',
    globeTint: '#ff86e2',
    globeImageUrl: EARTH_DARK,
    bg: '#0a0016',
    mapStyle: DARK,
    mapRecolor: { background: '#0a0016', water: '#16002e', land: '#100024', line: '#ff3cac', text: '#36e9ff' },
  },
  {
    id: 'amber',
    label: 'Amber CRT',
    accent: '#ffb000',
    atmosphere: '#ffb000',
    globeTint: '#ffcf73',
    globeImageUrl: EARTH_DARK,
    bg: '#0a0600',
    mapStyle: DARK,
    mapRecolor: { background: '#0a0600', water: '#1c1000', land: '#160c00', line: '#b97c00', text: '#ffc23d' },
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    accent: '#4d9fff',
    atmosphere: '#1e6fff',
    globeTint: '#74a8ff',
    globeImageUrl: EARTH_DARK,
    bg: '#00040d',
    mapStyle: DARK,
    mapRecolor: { background: '#00060f', water: '#001233', land: '#000c24', line: '#2f7bff', text: '#7fb4ff' },
  },
  {
    id: 'arctic',
    label: 'Arctic',
    accent: '#0ea5e9',
    atmosphere: '#aee3ff',
    globeTint: '#dff0ff',
    globeImageUrl: EARTH_DARK,
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
}
