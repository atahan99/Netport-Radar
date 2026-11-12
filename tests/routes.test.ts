import { describe, expect, it } from 'vitest';
import { aggregateRoutes } from '../src/lib/routes';
import { makeFlight } from './helpers';
import type { HomeAirport } from '../src/types';

const home: HomeAirport = { id: 'primary', label: 'Home', lat: 41, lng: 29, ip: '', isVpn: false };
const vpn: HomeAirport = { id: 'vpn-1', label: 'VPN', lat: 47, lng: 8, ip: '', isVpn: true };

describe('aggregateRoutes', () => {
  it('groups per home + country, sums traffic, ends at the busiest flight', () => {
    const routes = aggregateRoutes(
      [
        makeFlight({ country: 'US', dstLat: 1, dstLng: 1, bytesTotal: 10, bytesPerSec: 5 }),
        makeFlight({ country: 'US', dstLat: 2, dstLng: 2, bytesTotal: 50, bytesPerSec: 7 }),
        makeFlight({ country: 'US', homeAirportId: 'vpn-1', bytesTotal: 1 }),
        makeFlight({ country: 'DE', isLan: true }),
        makeFlight({ country: '??', geoConfidence: 'none' }),
        makeFlight({ country: 'FR', homeAirportId: 'gone' }),
      ],
      [home, vpn],
    );
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ key: 'primary|US', count: 2, bytes: 60, bytesPerSec: 12, lat: 2, lng: 2 });
    expect(routes[1]).toMatchObject({ key: 'vpn-1|US', count: 1 });
    expect(routes[1].home.isVpn).toBe(true);
  });
});
