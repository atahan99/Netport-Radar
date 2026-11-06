import { describe, it, expect } from 'vitest';
import { flightWorldPos } from '../src/lib/flight-pos';
import { makeFlight } from './helpers';
import type { HomeAirport } from '../src/types';

const HOME: HomeAirport = { id: 'primary', label: 'Home', lat: 41, lng: 29, ip: '', isVpn: false };

describe('flightWorldPos', () => {
  it('pins LAN flights to home (plus orbit), never out along a destination arc', () => {
    const f = makeFlight({ isLan: true, dstLat: -33, dstLng: 151, phase: 'cruise' });
    const p = flightWorldPos(f, HOME, 1000, 0.5);
    expect(p.baseLat).toBe(41);
    expect(p.baseLng).toBe(29);
    expect(Math.abs(p.lat - 41)).toBeLessThan(3);
    expect(p.alt).toBe(0.03);
  });

  it('follows the arc for remote flights, with altitude peaking mid-route', () => {
    const f = makeFlight({ isLan: false, dstLat: 40.7, dstLng: -74, phase: 'cruise' });
    const start = flightWorldPos(f, HOME, 0, 0);
    const mid = flightWorldPos(f, HOME, 0, 0.5);
    expect(start.baseLat).toBeCloseTo(41, 5);
    expect(mid.alt).toBeGreaterThan(start.alt);
    expect(mid.baseLng).toBeLessThan(29);
  });
});
