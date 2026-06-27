import { describe, it, expect, beforeEach } from 'vitest';
import { detectHomeAirports, haversineKm, type GeoInfo } from '../server/capture';

const geo = new Map<string, GeoInfo>();

function mockLookup(ip: string): GeoInfo | null {
  return geo.get(ip) ?? null;
}

describe('haversineKm', () => {
  it('Istanbul ↔ Zürich is well over 100km', () => {
    const km = haversineKm(41.01, 28.97, 47.37, 8.54);
    expect(km).toBeGreaterThan(1000);
  });

  it('two nearby Istanbul points cluster under 100km', () => {
    const km = haversineKm(41.01, 28.97, 41.05, 29.1);
    expect(km).toBeLessThan(100);
  });
});

describe('detectHomeAirports', () => {
  beforeEach(() => geo.clear());

  it('clusters nearby source IPs and marks the largest cluster primary', () => {
    geo.set('78.1.1.1', { lat: 41.0, lng: 29.0, country: 'TR', city: 'Istanbul', org: 'ISP', confidence: 'city' });
    geo.set('78.1.1.2', { lat: 41.01, lng: 29.01, country: 'TR', city: 'Istanbul', org: 'ISP', confidence: 'city' });
    geo.set('185.1.1.1', { lat: 47.37, lng: 8.54, country: 'CH', city: 'Zürich', org: 'VPN', confidence: 'city' });

    const homes = detectHomeAirports(['78.1.1.1', '78.1.1.2', '185.1.1.1'], mockLookup);
    expect(homes).toHaveLength(2);
    expect(homes[0].id).toBe('primary');
    expect(homes[0].isVpn).toBe(false);
    expect(homes[1].id).toBe('vpn-1');
    expect(homes[1].isVpn).toBe(true);
    expect(homes[1].label).toContain('VPN');
  });

  it('returns empty when no IPs geolocate', () => {
    expect(detectHomeAirports(['192.0.2.1'], mockLookup)).toEqual([]);
  });

  it('caps at three home airports', () => {
    for (let i = 1; i <= 4; i++) {
      geo.set(`10.0.0.${i}`, {
        lat: i * 15,
        lng: i * 15,
        country: 'XX',
        city: `site-${i}`,
        org: 'x',
        confidence: 'city',
      });
    }
    expect(detectHomeAirports(['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'], mockLookup)).toHaveLength(3);
  });
});
