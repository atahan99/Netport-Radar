import { describe, it, expect } from 'vitest';
import { THEMES, THEME_BY_ID, type ThemeName } from '../src/lib/themes';

describe('themes', () => {
  it('exposes 7 themes, indexable by id', () => {
    expect(THEMES).toHaveLength(7);
    for (const t of THEMES) expect(THEME_BY_ID[t.id]).toBe(t);
  });

  it('gives every theme the required HUD + globe fields', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.accent).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(t.atmosphere).toMatch(/^#/);
      expect(t.globeTint).toMatch(/^#/);
      expect(t.bg).toMatch(/^#/);
      expect(t.mapStyle).toBeTruthy();
    }
  });

  it('recolor themes carry a 2D recolor + 3D land/water', () => {
    const recolor: ThemeName[] = ['matrix', 'cyberpunk', 'amber', 'blueprint'];
    for (const id of recolor) {
      const t = THEME_BY_ID[id];
      expect(t.mapRecolor).toBeTruthy();
      expect(t.globeLand).toBeTruthy();
      expect(t.globeWater).toBeTruthy();
    }
  });

  it('Midnight is a vector globe (land/water) over the native 2D dark-matter map', () => {
    const m = THEME_BY_ID.midnight;
    expect(m.mapRecolor).toBeUndefined(); // native dark-matter on 2D
    expect(m.globeLand).toBeTruthy(); // but a themed vector globe in 3D
    expect(m.globeWater).toBeTruthy();
    expect(m.globeBorder).toBeTruthy();
  });

  it('Satellite keeps the realistic earth (no globe recolor, no 2D recolor)', () => {
    const s = THEME_BY_ID.satellite;
    expect(s.globeWater).toBeUndefined();
    expect(s.globeLand).toBeUndefined();
    expect(s.mapRecolor).toBeUndefined();
  });
});
