import { describe, it, expect } from 'vitest';
import { recolorValue } from '../src/lib/map-recolor';
import type { MapRecolor } from '../src/lib/themes';

const rc: MapRecolor = {
  background: '#bg',
  water: '#water',
  land: '#land',
  line: '#line',
  text: '#text',
};

describe('recolorValue', () => {
  it('keeps the original (undefined) when the theme has no recolor', () => {
    expect(recolorValue('background-color', 'background', undefined)).toBeUndefined();
    expect(recolorValue('fill-color', 'water', undefined)).toBeUndefined();
  });

  it('maps the background layer to the continent color', () => {
    expect(recolorValue('background-color', 'background', rc)).toBe('#bg');
  });

  it('splits fill-color into water vs. land by layer id', () => {
    expect(recolorValue('fill-color', 'water', rc)).toBe('#water');
    expect(recolorValue('fill-color', 'water_shadow', rc)).toBe('#water');
    expect(recolorValue('fill-color', 'landcover', rc)).toBe('#land');
    expect(recolorValue('fill-color', 'landuse_park', rc)).toBe('#land');
  });

  it('maps line and text colors', () => {
    expect(recolorValue('line-color', 'boundary_country', rc)).toBe('#line');
    expect(recolorValue('text-color', 'place_label', rc)).toBe('#text');
  });

  it('leaves untouched properties alone', () => {
    expect(recolorValue('circle-color', 'dests', rc)).toBeUndefined();
    expect(recolorValue('icon-opacity', 'poi', rc)).toBeUndefined();
  });
});
