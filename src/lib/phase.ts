// src/lib/phase.ts
// Single source of truth for flight-phase presentation (label, colors, meaning),
// shared by the Legend and the FlightCard so they never drift apart.
//
// NOTE: the badgeClass strings are full literals (not interpolated) so Tailwind's
// content scanner picks them up.

import type { FlightPhase } from '@/types';

export interface PhaseMeta {
  label: string; // UPPERCASE display label
  textClass: string; // bare text color (legend rows)
  badgeClass: string; // tinted pill: bg + text + border
  hex: string; // raw color (dot / ring)
  meaning: string; // plain-language explanation
}

export const PHASE_META: Record<FlightPhase, PhaseMeta> = {
  taxi: {
    label: 'TAXI',
    textClass: 'text-blue-400',
    badgeClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    hex: '#60a5fa',
    meaning: 'SYN — holding at home',
  },
  cruise: {
    label: 'CRUISE',
    textClass: 'text-emerald-400',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    hex: '#34d399',
    meaning: 'data flowing',
  },
  hold: {
    label: 'HOLD',
    textClass: 'text-amber-400',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    hex: '#fbbf24',
    meaning: 'idle — circling',
  },
  descent: {
    label: 'DESCENT',
    textClass: 'text-orange-400',
    badgeClass: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    hex: '#fb923c',
    meaning: 'FIN/RST — closing',
  },
  landed: {
    label: 'LANDED',
    textClass: 'text-zinc-500',
    badgeClass: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
    hex: '#71717a',
    meaning: 'closed — fading',
  },
};

export const PHASE_ORDER: FlightPhase[] = ['taxi', 'cruise', 'hold', 'descent', 'landed'];

// Progress-bar caption on the flight card: what the flight is doing right now,
// so a landed flight never reads "100% Departing".
export function progressCaption(phase: FlightPhase, direction: 'inbound' | 'outbound'): string {
  switch (phase) {
    case 'taxi':
      return 'Taxiing';
    case 'hold':
      return 'Holding';
    case 'descent':
      return 'Descending';
    case 'landed':
      return 'Landed';
    default:
      return direction === 'inbound' ? 'Arriving' : 'Departing';
  }
}
