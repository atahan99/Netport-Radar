// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { LiveState, isFlight, parseServerMessage } from '../src/lib/live-state';
import { useLiveFlights, liveReconnect } from '../src/lib/live';
import { useFlightsStore } from '../src/store/flights';
import { useConnectionStore } from '../src/store/connection';
import { makeFlight } from './helpers';

describe('LiveState', () => {
  it('init seeds from the snapshot and replaces stale flights', () => {
    const s = new LiveState();
    s.apply({ event: 'opened', flight: makeFlight({ id: 'OLD-1' }) }, 0);
    s.seed([makeFlight({ id: 'A' }), makeFlight({ id: 'B' }), { junk: true }], 10);
    expect(s.flights.map((f) => f.id)).toEqual(['A', 'B']);
    expect(s.byId.has('OLD-1')).toBe(false);
  });

  it('a repeated opened updates the flight instead of duplicating it', () => {
    const s = new LiveState();
    s.apply({ event: 'opened', flight: makeFlight({ id: 'A', bytesTotal: 1 }) }, 0);
    s.apply({ event: 'opened', flight: makeFlight({ id: 'A', bytesTotal: 99 }) }, 5);
    expect(s.flights).toHaveLength(1);
    expect(s.byId.get('A')?.bytesTotal).toBe(99);
  });

  it('patches only known fields with matching types (no prototype pollution)', () => {
    const s = new LiveState();
    s.apply({ event: 'opened', flight: makeFlight({ id: 'A' }) }, 0);
    const patch = JSON.parse(
      '{"bytesTotal":42,"process":7,"newField":"x","id":"B","__proto__":{"polluted":true}}',
    );
    s.apply({ event: 'updated', id: 'A', patch }, 1);
    const f = s.byId.get('A') as unknown as Record<string, unknown>;
    expect(f.bytesTotal).toBe(42);
    expect(typeof f.process).toBe('string');
    expect(f.newField).toBeUndefined();
    expect(f.id).toBe('A');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ignores malformed events and flights', () => {
    const s = new LiveState();
    for (const e of [null, 42, { event: 'opened' }, { event: 'opened', flight: { id: 'X' } }, { event: 'phase', id: 3 }]) {
      expect(() => s.apply(e as never, 0)).not.toThrow();
    }
    expect(s.flights).toHaveLength(0);
    expect(isFlight(makeFlight())).toBe(true);
  });

  it('drops unknown phases, aircraft types, unsafe colors and bad home airports', () => {
    for (const bad of [
      { phase: 'boarding' },
      { aircraftType: 'zeppelin' },
      { liveryColor: 'red;background:url(x)' },
    ]) {
      expect(isFlight(makeFlight(bad as never)), JSON.stringify(bad)).toBe(false);
    }
    const s = new LiveState();
    s.apply({ event: 'opened', flight: makeFlight({ id: 'A' }) }, 0);
    s.apply({ event: 'phase', id: 'A', phase: 'boarding' as never }, 1);
    s.apply(
      { event: 'updated', id: 'A', patch: { aircraftType: 'zeppelin', liveryColor: 'x;y', phase: 'nope' } as never },
      2,
    );
    const f = s.byId.get('A')!;
    expect([f.phase, f.aircraftType, f.liveryColor]).toEqual(['cruise', 'widebody', '#ffffff']);
    s.apply({ event: 'updated', id: 'A', patch: { aircraftType: 'cargo', liveryColor: '#ABC' } }, 3);
    expect([f.aircraftType, f.liveryColor]).toEqual(['cargo', '#ABC']);

    const home = { id: 'primary', label: 'x', lat: 1, lng: 2, ip: '', isVpn: false };
    const msg = parseServerMessage(
      JSON.stringify({ type: 'home_update', homeAirports: [home, { ...home, id: 'bad', lat: 'NaN' }, null] }),
    );
    expect(msg).toEqual({ type: 'home_update', homeAirports: [home] });
  });

  it('parseServerMessage rejects bad frames', () => {
    for (const raw of ['null', '[]', '{}', '{"type":"batch"}', '{"type":"init","homeAirports":[]}', 'nope', 7]) {
      expect(parseServerMessage(raw), String(raw)).toBeNull();
    }
    expect(parseServerMessage('{"type":"reset"}')).toEqual({ type: 'reset' });
  });
});

// Minimal WebSocket stand-in: records instances, lets the test drive events.
class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    // Real sockets fire close asynchronously.
    setTimeout(() => this.onclose?.({ code: 1006, reason: '' }), 0);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

describe('useLiveFlights reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    vi.stubGlobal('WebSocket', FakeWS);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useFlightsStore.setState({ flights: [], selectedFlightId: null });
  });

  it('"Try now" leaves exactly one socket: the old one cannot schedule another', () => {
    renderHook(() => useLiveFlights(true));
    expect(FakeWS.instances).toHaveLength(1);
    liveReconnect.now(); // user clicks Try now while the first is still connecting
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1].open();
    vi.advanceTimersByTime(10_000); // old socket's onclose fires; no retry should follow
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('the attempt counter keeps counting through an outage and resets on connect', () => {
    renderHook(() => useLiveFlights(true));
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      FakeWS.instances.at(-1)!.close();
      vi.advanceTimersByTime(3100);
      seen.push(useConnectionStore.getState().attempt);
    }
    expect(seen).toEqual([2, 3, 4]);
    FakeWS.instances.at(-1)!.open();
    expect(useConnectionStore.getState()).toMatchObject({ reconnecting: false, attempt: 0 });
  });

  it('moves ?token from the URL into sessionStorage and uses it for the socket', () => {
    history.replaceState(null, '', '/?token=s3cret&x=1');
    renderHook(() => useLiveFlights(true));
    expect(location.search).toBe('?x=1');
    expect(FakeWS.instances[0].url).toContain('token=s3cret');
    FakeWS.instances[0].close();
    vi.advanceTimersByTime(3100);
    expect(FakeWS.instances[1].url).toContain('token=s3cret');
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('pruning or a reset clears a selection whose flight is gone', () => {
    renderHook(() => useLiveFlights(true));
    const ws = FakeWS.instances[0];
    ws.open();
    const base = { homeAirports: [], backend: { capture: 'tshark', dpiMode: 'full', iface: 'en0', interfaces: [] } };
    ws.message({ type: 'init', ...base, flights: [makeFlight({ id: 'A' }), makeFlight({ id: 'B' })] });
    vi.advanceTimersByTime(200);
    useFlightsStore.getState().selectFlight('A');
    ws.message({ type: 'batch', events: [{ event: 'closed', id: 'A', bytesTotal: 1, durationMs: 1 }] });
    vi.advanceTimersByTime(200);
    expect(useFlightsStore.getState().selectedFlightId).toBe('A'); // still lingering
    vi.advanceTimersByTime(63_000); // past LANDED_TTL_MS → pruned
    expect(useFlightsStore.getState().flights.map((f) => f.id)).toEqual(['B']);
    expect(useFlightsStore.getState().selectedFlightId).toBeNull();
  });

  it('init after a reconnect replaces the flight list with the snapshot', () => {
    renderHook(() => useLiveFlights(true));
    const ws1 = FakeWS.instances[0];
    ws1.open();
    const base = { homeAirports: [], backend: { capture: 'tshark', dpiMode: 'full', iface: 'en0', interfaces: [] } };
    ws1.message({ type: 'init', ...base, flights: [] });
    ws1.message({ type: 'batch', events: [{ event: 'opened', flight: makeFlight({ id: 'STALE' }) }] });
    ws1.close();
    vi.advanceTimersByTime(3100); // retry
    const ws2 = FakeWS.instances[1];
    ws2.open();
    ws2.message({ type: 'init', ...base, flights: [makeFlight({ id: 'FRESH' })] });
    vi.advanceTimersByTime(200); // let the rAF loop push to the store
    expect(useFlightsStore.getState().flights.map((f) => f.id)).toEqual(['FRESH']);
  });
});
