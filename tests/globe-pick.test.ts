import { describe, it, expect } from 'vitest';
import { pickFlightAt } from '../src/lib/globe-planes';
import type { GlobeApi } from '../src/lib/view-refs';
import type { HomeAirport } from '../src/types';
import { makeFlight } from './helpers';

const HOME: HomeAirport = { id: 'primary', label: 'Home', lat: 0, lng: 0, ip: '', isVpn: false };

// Flat fake projection: screen x/y = lng/lat; points with lat < -50 count as
// "behind the globe" (farther from the camera than its distance to the center).
const fakeGlobe = {
  camera: () => ({ position: { x: 0, y: 0, z: 100 } }),
  getCoords: (lat: number, lng: number) => ({ x: lng, y: lat, z: lat < -50 ? -200 : 50 }),
  getScreenCoords: (lat: number, lng: number) => ({ x: lng, y: lat }),
} as unknown as GlobeApi;

describe('pickFlightAt', () => {
  const lan = (id: string) =>
    makeFlight({ id, isLan: true, phase: 'landed', homeAirportId: 'h' });
  const homeAt = (lat: number, lng: number) => () => ({ ...HOME, lat, lng });

  it('returns the nearest plane within the radius', () => {
    const near = lan('NEAR');
    const pick = pickFlightAt(fakeGlobe, [near], homeAt(10, 10), 12, 11, 5, 0);
    expect(pick?.id).toBe('NEAR');
    expect(pickFlightAt(fakeGlobe, [near], homeAt(10, 10), 40, 40, 5, 0)).toBeNull();
  });

  it('ignores planes on the far side of the globe', () => {
    const hidden = lan('HIDDEN');
    expect(pickFlightAt(fakeGlobe, [hidden], homeAt(-60, 0), 0, -60, 5, 0)).toBeNull();
  });
});
