import { describe, it, expect } from 'vitest';
import {
  rgba,
  solidGlobeTexture,
  resolveGlobeImage,
  globeBorderColor,
  useVectorPolygons,
  polygonCapColor,
  polygonSideColor,
  polygonStrokeColor,
  homeRingColor,
  pathGradientColors,
} from '../src/lib/globe-color';
import { THEME_BY_ID } from '../src/lib/themes';

describe('rgba', () => {
  it('converts hex + alpha to rgba()', () => {
    expect(rgba('#ff0000', 0.5)).toBe('rgba(255,0,0,0.500)');
    expect(rgba('#4285F4', 1)).toBe('rgba(66,133,244,1.000)');
  });
});

describe('solidGlobeTexture', () => {
  it('returns an encoded SVG data URL', () => {
    const url = solidGlobeTexture('#0c0d12');
    expect(url).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toContain('#0c0d12');
  });
});

describe('resolveGlobeImage', () => {
  it('uses flat ocean texture when globeWater is set', () => {
    const url = resolveGlobeImage(THEME_BY_ID.matrix);
    expect(url).toMatch(/^data:image\/svg\+xml,/);
  });

  it('uses photo texture when globeWater is absent', () => {
    expect(resolveGlobeImage(THEME_BY_ID.satellite)).toBe(THEME_BY_ID.satellite.globeImageUrl);
  });
});

describe('globeBorderColor', () => {
  it('prefers globeBorder, then mapRecolor.line, then accent', () => {
    expect(globeBorderColor(THEME_BY_ID.midnight)).toBe('#666666');
    expect(globeBorderColor(THEME_BY_ID.matrix)).toBe('#00c853');
    expect(globeBorderColor(THEME_BY_ID.satellite)).toBe(THEME_BY_ID.satellite.accent);
  });
});

describe('useVectorPolygons', () => {
  it('true for themed vector globes, false for satellite photo', () => {
    expect(useVectorPolygons(THEME_BY_ID.midnight)).toBe(true);
    expect(useVectorPolygons(THEME_BY_ID.satellite)).toBe(false);
  });
});

describe('polygon colors', () => {
  it('caps are transparent (borders only over the shader-recolored terrain)', () => {
    expect(polygonCapColor()).toBe('rgba(0,0,0,0)');
    expect(polygonSideColor()).toBe('rgba(0,0,0,0)');
    expect(polygonStrokeColor('#474c57')).toBe('#474c57');
  });
});

describe('homeRingColor', () => {
  it('VPN is purple, primary is white', () => {
    expect(homeRingColor(true)).toBe('#8b5cf6');
    expect(homeRingColor(false)).toBe('#ffffff');
  });
});

describe('pathGradientColors', () => {
  it('ramps alpha from 0 to 0.9 across steps+1 points', () => {
    const colors = pathGradientColors('#ff0000', 4);
    expect(colors).toHaveLength(5);
    expect(colors[0]).toBe('rgba(255,0,0,0.000)');
    expect(colors[4]).toBe('rgba(255,0,0,0.900)');
  });
});
