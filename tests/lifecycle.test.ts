import { describe, it, expect, vi } from 'vitest';
import { lifecyclePose } from '../src/lib/lifecycle';
import { reducedMotion } from '../src/lib/motion';
import { makeFlight } from './helpers';

vi.mock('../src/lib/motion', () => ({ reducedMotion: vi.fn(() => false) }));

describe('lifecyclePose', () => {
  it('landed: static shrink + fade', () => {
    const p = lifecyclePose(makeFlight({ phase: 'landed' }), 1234);
    expect(p).toEqual({ dLat: 0, dLng: 0, scale: 0.85, opacity: 0.3 });
  });

  it('cruise: identity pose (no offset, full scale/opacity)', () => {
    const p = lifecyclePose(makeFlight({ phase: 'cruise' }), 5000);
    expect(p).toEqual({ dLat: 0, dLng: 0, scale: 1, opacity: 1 });
  });

  it('taxi: pulsing scale [0.8,1.0] + opacity [0.9,1.0], no positional offset', () => {
    const f = makeFlight({ phase: 'taxi' });
    for (const t of [0, 150, 300, 450, 900, 1500]) {
      const p = lifecyclePose(f, t);
      expect(p.dLat).toBe(0);
      expect(p.dLng).toBe(0);
      expect(p.scale).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(1.0 + 1e-9);
      expect(p.opacity).toBeGreaterThanOrEqual(0.9);
      expect(p.opacity).toBeLessThanOrEqual(1.0 + 1e-9);
    }
  });

  it('hold: orbit within radius (rLat 1.2, rLng 2.0), period 6000', () => {
    const f = makeFlight({ phase: 'hold' });
    for (const t of [0, 1500, 3000, 4500]) {
      const p = lifecyclePose(f, t);
      expect(Math.abs(p.dLat)).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.abs(p.dLng)).toBeLessThanOrEqual(2.0 + 1e-9);
      expect(p.scale).toBe(1);
    }
    const a = lifecyclePose(f, 1234);
    const b = lifecyclePose(f, 1234 + 6000); // one period later → same point
    expect(a.dLat).toBeCloseTo(b.dLat, 6);
    expect(a.dLng).toBeCloseTo(b.dLng, 6);
  });

  it('LAN orbit (period 11000, larger radius), never landed-static while flying', () => {
    const f = makeFlight({ isLan: true, phase: 'cruise' });
    const a = lifecyclePose(f, 2000);
    expect(Math.abs(a.dLat)).toBeLessThanOrEqual(1.6 + 1e-9);
    expect(Math.abs(a.dLng)).toBeLessThanOrEqual(2.6 + 1e-9);
    const b = lifecyclePose(f, 2000 + 11000);
    expect(a.dLat).toBeCloseTo(b.dLat, 6);
  });

  it('distinct flights get distinct phase offsets (orbits do not stack)', () => {
    const p1 = lifecyclePose(makeFlight({ id: 'AAA-000001', phase: 'hold' }), 1000);
    const p2 = lifecyclePose(makeFlight({ id: 'ZZZ-FFFFFF', phase: 'hold' }), 1000);
    expect(p1.dLat).not.toBe(p2.dLat);
  });

  it('reduced motion: static poses (landed keeps its dim, LAN keeps 0.9)', () => {
    vi.mocked(reducedMotion).mockReturnValue(true);
    expect(lifecyclePose(makeFlight({ phase: 'hold' }), 1234)).toEqual({ dLat: 0, dLng: 0, scale: 1, opacity: 1 });
    expect(lifecyclePose(makeFlight({ phase: 'taxi' }), 1234)).toEqual({ dLat: 0, dLng: 0, scale: 1, opacity: 1 });
    expect(lifecyclePose(makeFlight({ isLan: true, phase: 'cruise' }), 1234)).toEqual({ dLat: 0, dLng: 0, scale: 1, opacity: 0.9 });
    expect(lifecyclePose(makeFlight({ phase: 'landed' }), 1234)).toEqual({ dLat: 0, dLng: 0, scale: 0.85, opacity: 0.3 });
    vi.mocked(reducedMotion).mockReturnValue(false);
  });
});
