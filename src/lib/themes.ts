// src/lib/themes.ts
// Color themes applied across the 2D map, 3D globe, and HUD accent.
// Hybrid recolor: a CSS filter tints the MapLibre tile canvas (not the DOM
// markers — those keep their per-app livery), the globe earth material is
// multiplied by globeTint, the atmosphere glow + HUD accent recolor, and the
// app background shifts. Midnight is the native untinted look.

export type ThemeName = 'midnight' | 'matrix' | 'cyberpunk' | 'amber' | 'arctic' | 'blueprint';

export interface Theme {
  id: ThemeName;
  label: string;
  accent: string; // HUD accent (--theme-accent): wordmark, rings, focus
  atmosphere: string; // globe atmosphere glow
  globeTint: string; // multiplies the earth texture (white = untinted)
  mapFilter: string; // CSS filter on .maplibregl-canvas ('' = none)
  bg: string; // app background
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    accent: '#4285F4',
    atmosphere: '#3a82ff',
    globeTint: '#ffffff',
    mapFilter: '',
    bg: '#000000',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    accent: '#28ff8e',
    atmosphere: '#00ff66',
    globeTint: '#4dff9e',
    mapFilter: 'sepia(1) hue-rotate(55deg) saturate(2.2) brightness(0.85)',
    bg: '#000a04',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    accent: '#ff3cac',
    atmosphere: '#ff2bd6',
    globeTint: '#ff86e2',
    mapFilter: 'sepia(1) hue-rotate(255deg) saturate(2.6) contrast(1.08) brightness(0.9)',
    bg: '#0a0016',
  },
  {
    id: 'amber',
    label: 'Amber CRT',
    accent: '#ffb000',
    atmosphere: '#ffb000',
    globeTint: '#ffcf73',
    mapFilter: 'sepia(1) hue-rotate(-18deg) saturate(2.4) brightness(1)',
    bg: '#0a0600',
  },
  {
    id: 'arctic',
    label: 'Arctic',
    accent: '#7dd3fc',
    atmosphere: '#aee3ff',
    globeTint: '#d4eeff',
    mapFilter: 'hue-rotate(170deg) saturate(0.55) brightness(1.2)',
    bg: '#03070c',
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    accent: '#4d9fff',
    atmosphere: '#1e6fff',
    globeTint: '#74a8ff',
    mapFilter: 'sepia(1) hue-rotate(185deg) saturate(3) brightness(0.85)',
    bg: '#00040d',
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
  r.style.setProperty('--theme-map-filter', t.mapFilter || 'none');
  r.style.setProperty('--theme-bg', t.bg);
}
