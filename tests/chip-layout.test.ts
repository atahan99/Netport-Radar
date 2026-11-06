import { describe, it, expect } from 'vitest';
import { placeChips, chipSize } from '../src/lib/chip-layout';

const box = (id: string, x: number, y: number) => ({ id, x, y, ...chipSize('TCP-ABC123 ~US') });

describe('placeChips', () => {
  it('keeps the first (highest priority) of overlapping chips', () => {
    const shown = placeChips([box('sel', 100, 100), box('b', 105, 102), box('c', 300, 100)]);
    expect([...shown]).toEqual(['sel', 'c']);
  });

  it('allows stacked chips that do not touch, and respects the cap', () => {
    expect(placeChips([box('a', 100, 100), box('b', 100, 130)]).size).toBe(2);
    expect(placeChips([box('a', 0, 100), box('b', 300, 100), box('c', 600, 100)], 2).size).toBe(2);
  });
});
