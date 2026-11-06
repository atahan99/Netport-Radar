import { describe, it, expect } from 'vitest';
import { getRenderQueue, getRenderQueueMemo, passesFilters } from '../src/lib/render-queue';
import { makeFlight, makeFilters } from './helpers';

const F = makeFilters();

describe('render-queue caps', () => {
  it('caps main pool at 150 and reports off-screen count', () => {
    const flights = Array.from({ length: 200 }, () => makeFlight({ phase: 'cruise' }));
    const q = getRenderQueue(flights, F);
    expect(q.mainQueue.length).toBe(150);
    expect(q.offScreenCount).toBe(50);
  });

  it('caps DNS pool at 20 separately', () => {
    const drones = Array.from({ length: 30 }, () => makeFlight({ aircraftType: 'drone', detectedProtocol: 'DNS' }));
    const q = getRenderQueue(drones, makeFilters({ dnsDensity: 'all' }));
    expect(q.dnsQueue.length).toBe(20);
    expect(q.mainQueue.length).toBe(0);
  });
});

describe('bump priority', () => {
  it('evicts landed before cruise when over cap', () => {
    const flights = [
      ...Array.from({ length: 150 }, () => makeFlight({ phase: 'cruise' })),
      makeFlight({ id: 'LAND-000001', phase: 'landed' }),
    ];
    const q = getRenderQueue(flights, F);
    expect(q.mainQueue.some((f) => f.id === 'LAND-000001')).toBe(false);
  });

  it('keeps hold over landed; never evicts cruise while lower phases present', () => {
    const flights = [
      ...Array.from({ length: 149 }, () => makeFlight({ phase: 'cruise' })),
      makeFlight({ id: 'HOLD-1', phase: 'hold' }),
      makeFlight({ id: 'LAND-1', phase: 'landed' }),
    ];
    const q = getRenderQueue(flights, F); // 151 → cap 150
    expect(q.mainQueue.some((f) => f.id === 'HOLD-1')).toBe(true);
    expect(q.mainQueue.some((f) => f.id === 'LAND-1')).toBe(false);
    expect(q.mainQueue.filter((f) => f.phase === 'cruise').length).toBe(149);
  });
});

describe('DNS density', () => {
  const drones = [0, 5, 10, 15].map((startedAt) =>
    makeFlight({ aircraftType: 'drone', detectedProtocol: 'DNS', startedAt }),
  );
  it('none → empties the DNS pool', () => {
    expect(getRenderQueue(drones, makeFilters({ dnsDensity: 'none' })).dnsQueue.length).toBe(0);
  });
  it('all → keeps every drone', () => {
    expect(getRenderQueue(drones, makeFilters({ dnsDensity: 'all' })).dnsQueue.length).toBe(4);
  });
  it('sample → keeps the startedAt % 10 === 0 bucket', () => {
    const q = getRenderQueue(drones, makeFilters({ dnsDensity: 'sample' }));
    expect(q.dnsQueue.map((f) => f.startedAt).sort((a, b) => a - b)).toEqual([0, 10]);
  });
});

describe('passesFilters', () => {
  it('protocol family toggles', () => {
    const https = makeFlight({ detectedProtocol: 'HTTPS' });
    expect(passesFilters(https, makeFilters({ showHTTPS: false }))).toBe(false);
    expect(passesFilters(makeFlight({ detectedProtocol: 'WireGuard' }), makeFilters({ showVPN: false }))).toBe(false);
    expect(passesFilters(makeFlight({ detectedProtocol: 'SSH' }), makeFilters({ showSSH: false }))).toBe(false);
  });
  it('LAN / IPv6 / direction', () => {
    expect(passesFilters(makeFlight({ isLan: true }), makeFilters({ showLAN: false }))).toBe(false);
    expect(passesFilters(makeFlight({ isIPv6: true }), makeFilters({ showIPv6: false }))).toBe(false);
    expect(passesFilters(makeFlight({ direction: 'inbound' }), makeFilters({ direction: 'outbound' }))).toBe(false);
    expect(passesFilters(makeFlight({ direction: 'inbound' }), makeFilters({ direction: 'inbound' }))).toBe(true);
  });
  it('appSearch is case-insensitive on process', () => {
    const f = makeFlight({ process: 'chrome' });
    expect(passesFilters(f, makeFilters({ appSearch: 'CHR' }))).toBe(true);
    expect(passesFilters(f, makeFilters({ appSearch: 'firefox' }))).toBe(false);
  });
  it('isolatedCountry + airportFilter', () => {
    expect(passesFilters(makeFlight({ country: 'US' }), makeFilters({ isolatedCountry: 'DE' }))).toBe(false);
    expect(passesFilters(makeFlight({ country: 'DE' }), makeFilters({ isolatedCountry: 'DE' }))).toBe(true);
    expect(passesFilters(makeFlight({ homeAirportId: 'vpn-1' }), makeFilters({ airportFilter: 'primary' }))).toBe(false);
    expect(passesFilters(makeFlight({ homeAirportId: 'primary' }), makeFilters({ airportFilter: 'vpn' }))).toBe(false);
  });
});

describe('getRenderQueueMemo', () => {
  it('returns the identical object for identical refs', () => {
    const flights = [makeFlight()];
    const filters = makeFilters();
    const a = getRenderQueueMemo(flights, filters);
    const b = getRenderQueueMemo(flights, filters);
    expect(a).toBe(b);
    const c = getRenderQueueMemo([makeFlight()], filters); // new array ref
    expect(c).not.toBe(a);
  });
});

describe('getRenderQueueMemo keys on filter values, not object identity', () => {
  it('returns the cached queue for an equal filter selection', async () => {
    const { getRenderQueueMemo } = await import('../src/lib/render-queue');
    const { selectFilterData } = await import('../src/store/filters');
    const flights = [makeFlight({ id: 'A' })];
    const full = makeFilters();
    const a = getRenderQueueMemo(flights, full);
    const b = getRenderQueueMemo(flights, selectFilterData(full));
    expect(b).toBe(a);
    const c = getRenderQueueMemo(flights, { ...selectFilterData(full), showHTTPS: false });
    expect(c).not.toBe(a);
  });
});
