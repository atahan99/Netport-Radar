import { describe, it, expect } from 'vitest';
import { trailWidth } from '../src/lib/trail-width';

describe('trailWidth', () => {
  it('grows on a log scale and caps', () => {
    expect(trailWidth(0, false)).toBe(1);
    expect(trailWidth(50_000, false)).toBe(1.3);
    expect(trailWidth(1e12, false)).toBe(2.2);
  });
  it('emphasizes the selected flight', () => {
    expect(trailWidth(0, true)).toBe(1.6);
    expect(trailWidth(1e12, true)).toBe(3.5);
  });
  it('treats junk as idle and returns 0.1 steps', () => {
    expect(trailWidth(NaN, false)).toBe(1);
    expect(trailWidth(-5, false)).toBe(1);
    for (const b of [1, 777, 12_345, 3e6]) {
      expect(Math.round(trailWidth(b, false) * 10)).toBeCloseTo(trailWidth(b, false) * 10, 9);
    }
  });
});
