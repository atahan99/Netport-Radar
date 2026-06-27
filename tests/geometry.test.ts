import { describe, it, expect } from 'vitest';
import { interpolateArc, arcPoints, greatCircleKm, arcAltitude } from '../src/lib/interpolate';
import { flightEndpoints } from '../src/lib/arc';
import { makeFlight } from './helpers';
import type { HomeAirport } from '../src/types';

const HOME: HomeAirport = { id: 'primary', label: 'Istanbul', lat: 41, lng: 29, ip: '', isVpn: false };

describe('interpolateArc', () => {
  it('endpoints: progress 0 = source, 1 = destination', () => {
    const a = interpolateArc(41, 29, 51, 0, 0);
    expect(a.lat).toBeCloseTo(41, 4);
    expect(a.lng).toBeCloseTo(29, 4);
    const b = interpolateArc(41, 29, 51, 0, 1);
    expect(b.lat).toBeCloseTo(51, 4);
    expect(b.lng).toBeCloseTo(0, 4);
  });

  it('clamps progress to [0,1]', () => {
    expect(interpolateArc(0, 0, 10, 10, -5)).toMatchObject(interpolateArc(0, 0, 10, 10, 0));
    expect(interpolateArc(0, 0, 10, 10, 5)).toMatchObject(interpolateArc(0, 0, 10, 10, 1));
  });

  it('midpoint lies between the endpoints', () => {
    const m = interpolateArc(0, 0, 0, 60, 0.5);
    expect(m.lng).toBeGreaterThan(0);
    expect(m.lng).toBeLessThan(60);
    expect(Math.abs(m.lat)).toBeLessThan(20); // great circle along the equator stays near 0
  });
});

describe('arcPoints', () => {
  it('returns steps+1 [lng,lat] points, partial when upTo<1', () => {
    const pts = arcPoints(41, 29, 51, 0, 1, 16);
    expect(pts).toHaveLength(17);
    expect(pts[0]).toEqual([29, 41]); // [lng, lat]
    const partial = arcPoints(41, 29, 51, 0, 0.5, 16);
    // last point of a half arc is short of the destination
    expect(partial[16][1]).toBeLessThan(51);
  });
});

describe('greatCircleKm', () => {
  it('zero for identical points; ~plausible for known distances', () => {
    expect(greatCircleKm(41, 29, 41, 29)).toBeCloseTo(0, 5);
    // Istanbul → London ≈ 2500 km
    const d = greatCircleKm(41.0, 28.97, 51.5, -0.13);
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(3000);
  });
});

describe('arcAltitude', () => {
  it('increases in bands with distance', () => {
    expect(arcAltitude(500)).toBe(0.1);
    expect(arcAltitude(3000)).toBe(0.2);
    expect(arcAltitude(500)).toBeLessThan(arcAltitude(8000));
  });
});

describe('flightEndpoints', () => {
  it('outbound = home → dest', () => {
    const ep = flightEndpoints(HOME, makeFlight({ direction: 'outbound', dstLat: 51, dstLng: 0 }));
    expect(ep).toEqual({ startLat: 41, startLng: 29, endLat: 51, endLng: 0 });
  });
  it('inbound = dest → home (plane arrives home)', () => {
    const ep = flightEndpoints(HOME, makeFlight({ direction: 'inbound', dstLat: 51, dstLng: 0 }));
    expect(ep).toEqual({ startLat: 51, startLng: 0, endLat: 41, endLng: 29 });
  });
  it('missing home falls back to 0,0', () => {
    const ep = flightEndpoints(undefined, makeFlight({ direction: 'outbound', dstLat: 10, dstLng: 20 }));
    expect(ep.startLat).toBe(0);
    expect(ep.startLng).toBe(0);
  });
});
