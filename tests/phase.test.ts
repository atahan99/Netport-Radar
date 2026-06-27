import { describe, it, expect } from 'vitest';
import { PHASE_META, PHASE_ORDER } from '../src/lib/phase';
import type { FlightPhase } from '../src/types';

const ALL: FlightPhase[] = ['taxi', 'cruise', 'hold', 'descent', 'landed'];

describe('PHASE_META / PHASE_ORDER', () => {
  it('covers exactly the five flight phases, in order', () => {
    expect(PHASE_ORDER).toEqual(ALL);
    expect(Object.keys(PHASE_META).sort()).toEqual([...ALL].sort());
  });

  it('gives every phase complete presentation fields', () => {
    for (const p of PHASE_ORDER) {
      const m = PHASE_META[p];
      expect(m.label).toBe(p.toUpperCase());
      expect(m.textClass).toMatch(/^text-/);
      // badge pill carries a border + bg + text utility (full literals for Tailwind)
      expect(m.badgeClass).toMatch(/border-/);
      expect(m.badgeClass).toMatch(/bg-/);
      expect(m.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.meaning.length).toBeGreaterThan(0);
    }
  });
});
