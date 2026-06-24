import { describe, it, expect } from 'vitest';
import { filterChips } from '../src/lib/filter-chips';
import { makeFilters } from './helpers';

describe('filterChips', () => {
  it('returns no chips for the default filter state', () => {
    // DEFAULTS use dnsDensity 'sample'; the helper defaults to 'all', so override.
    expect(filterChips(makeFilters({ dnsDensity: 'sample' }))).toEqual([]);
  });

  it('adds a chip per hidden protocol / traffic toggle', () => {
    const chips = filterChips(
      makeFilters({ dnsDensity: 'sample', showHTTPS: false, showLAN: false }),
    );
    expect(chips.map((c) => c.label)).toEqual(
      expect.arrayContaining(['HTTPS off', 'LAN off']),
    );
    expect(chips.map((c) => c.key)).toEqual(
      expect.arrayContaining(['showHTTPS', 'showLAN']),
    );
  });

  it('adds chips for non-default dns / direction / search / country / airport', () => {
    const chips = filterChips(
      makeFilters({
        dnsDensity: 'none',
        direction: 'outbound',
        appSearch: 'brave',
        isolatedCountry: 'DE',
        airportFilter: 'vpn',
      }),
    );
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c.label]));
    expect(byKey.dnsDensity).toBe('DNS: none');
    expect(byKey.direction).toBe('outbound only');
    expect(byKey.appSearch).toBe('Search: "brave"');
    expect(byKey.isolatedCountry).toBe('Country: DE');
    expect(byKey.airportFilter).toBe('Home: vpn');
  });
});
