// src/lib/chip-layout.ts
// Greedy label placement for the 2D callsign chips: candidates arrive in
// priority order (selected first, then by throughput) and a chip is shown only
// if its screen box doesn't overlap one already placed. Keeps dense spots
// (a country-centroid pile, a busy hub) readable instead of a stack of chips.

export interface ChipBox {
  id: string;
  x: number; // box center
  y: number; // box bottom
  w: number;
  h: number;
}

const PAD = 2;

export function placeChips(candidates: ChipBox[], max = Infinity): Set<string> {
  const placed: ChipBox[] = [];
  const out = new Set<string>();
  for (const c of candidates) {
    if (out.size >= max) break;
    const l = c.x - c.w / 2;
    const r = c.x + c.w / 2;
    const t = c.y - c.h;
    const hit = placed.some(
      (p) =>
        l < p.x + p.w / 2 + PAD && r > p.x - p.w / 2 - PAD && t < p.y + PAD && c.y > p.y - p.h - PAD,
    );
    if (hit) continue;
    placed.push(c);
    out.add(c.id);
  }
  return out;
}

// Rough chip size for 9px monospace text with 4px padding.
export function chipSize(text: string): { w: number; h: number } {
  return { w: text.length * 5.6 + 10, h: 14 };
}
