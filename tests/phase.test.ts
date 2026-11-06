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

describe('progressCaption', () => {
  it('describes the current phase instead of always saying Departing', async () => {
    const { progressCaption } = await import('../src/lib/phase');
    expect(progressCaption('landed', 'outbound')).toBe('Landed');
    expect(progressCaption('cruise', 'outbound')).toBe('Departing');
    expect(progressCaption('cruise', 'inbound')).toBe('Arriving');
    expect(progressCaption('hold', 'outbound')).toBe('Holding');
  });
});

describe('dpiLabel', () => {
  it('names the inspection mode, with a caller-chosen placeholder', async () => {
    const { dpiLabel } = await import('../src/lib/format');
    expect(dpiLabel(null, true, '…')).toBe('demo');
    expect(dpiLabel(null, false, '—')).toBe('—');
    expect(dpiLabel({ dpiMode: 'full' }, false, '…')).toBe('tshark');
    expect(dpiLabel({ dpiMode: 'port-based' }, false, '…')).toBe('port-based');
  });
});
