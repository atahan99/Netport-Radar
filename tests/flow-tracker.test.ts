import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Keep reverse-DNS + process lookup off the network / OS so tests are hermetic.
vi.mock('dns/promises', () => ({ reverse: vi.fn().mockRejectedValue(new Error('no dns')) }));
vi.mock('../server/process-names', () => ({
  lookupProcess: vi.fn(() => null),
  startProcessPolling: vi.fn(),
  stopProcessPolling: vi.fn(),
}));

import { FlowTracker, type FlowTrackerOpts } from '../server/flow-tracker';
import { lookupProcess } from '../server/process-names';
import type { RawPacket } from '../server/capture';
import type { FlightEvent, HomeAirport } from '../src/types';

const mockLookup = lookupProcess as Mock;
const HOME: HomeAirport = { id: 'primary', label: 'Istanbul', lat: 41, lng: 29, ip: '192.168.1.5', isVpn: false };

function pkt(over: Partial<RawPacket> = {}): RawPacket {
  return {
    srcIp: '192.168.1.5',
    dstIp: '8.8.8.8',
    srcPort: 50000,
    dstPort: 443,
    protocol: 'TCP',
    detectedProtocol: 'HTTPS',
    length: 100,
    direction: 'outbound',
    isIPv6: false,
    ...over,
  };
}

function setup(extra: Partial<FlowTrackerOpts> = {}) {
  const events: FlightEvent[] = [];
  const tracker = new FlowTracker({
    getHomeAirports: () => [HOME],
    onEvent: (e) => events.push(e),
    onSourceIp: () => {},
    ...extra,
  });
  return { events, tracker };
}

const opened = (events: FlightEvent[]) =>
  events.find((e): e is Extract<FlightEvent, { event: 'opened' }> => e.event === 'opened');

beforeEach(() => {
  vi.useFakeTimers();
  mockLookup.mockReturnValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('DNS hold (taxi)', () => {
  it('does not open before 2s without a hostname, then opens', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt());
    await vi.advanceTimersByTimeAsync(1500);
    expect(opened(events)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000); // > 2s total
    expect(opened(events)).toBeDefined();
    tracker.stop();
  });

  it('opens immediately when a hostname is present on the first packet', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com' }));
    await vi.advanceTimersByTimeAsync(300); // one tick
    expect(opened(events)?.flight.hostname).toBe('x.com');
    tracker.stop();
  });
});

describe('phase machine', () => {
  it('walks opened(cruise) → hold → cruise → descent → closed', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com', length: 500 })); // bytes → opens as cruise
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(5200); // idle > 5s → hold
    tracker.ingest(pkt({ host: 'x.com', length: 500 })); // data resumes → cruise
    await vi.advanceTimersByTimeAsync(300);
    tracker.ingest(pkt({ tcpFin: true, length: 0 })); // FIN → descent
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(2100); // descent timer → closed

    const seq = events
      .filter((e) => e.event === 'opened' || e.event === 'phase' || e.event === 'closed')
      .map((e) => (e.event === 'phase' ? `phase:${e.phase}` : e.event));
    expect(seq).toEqual(['opened', 'phase:hold', 'phase:cruise', 'phase:descent', 'closed']);
    expect(opened(events)?.flight.phase).toBe('cruise');
    tracker.stop();
  });

  it('force-closes a stale flow after 120s of silence', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com' }));
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(121_000);
    expect(events.some((e) => e.event === 'closed')).toBe(true);
    tracker.stop();
  });
});

describe('ingest drops (never become flights)', () => {
  it('drops loopback, multicast, broadcast, PTR self-noise, and geo-probe IPs', async () => {
    const { events, tracker } = setup({ selfProbeIps: new Set(['9.9.9.9']) });
    tracker.ingest(pkt({ dstIp: '127.0.0.1' }));
    tracker.ingest(pkt({ dstIp: '224.0.0.251' }));
    tracker.ingest(pkt({ dstIp: '255.255.255.255' }));
    tracker.ingest(pkt({ dstIp: '8.8.4.4', host: '4.4.8.8.in-addr.arpa' }));
    tracker.ingest(pkt({ dstIp: '9.9.9.9' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(events.filter((e) => e.event === 'opened')).toHaveLength(0);
    tracker.stop();
  });
});

describe('destination placement', () => {
  it('LAN (RFC1918) parks at home and labels it', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ dstIp: '192.168.1.50', host: 'nas.local' }));
    await vi.advanceTimersByTimeAsync(300);
    const f = opened(events)!.flight;
    expect(f.isLan).toBe(true);
    expect(f.country).toBe('LAN');
    expect(f.city).toBe('Local network');
    expect(f.dstLat).toBe(HOME.lat);
    tracker.stop();
  });

  it('CGNAT/Tailscale labels as Tailscale / CGNAT', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ dstIp: '100.100.5.5', host: 'peer.ts' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(opened(events)!.flight.city).toBe('Tailscale / CGNAT');
    tracker.stop();
  });

  it('un-geolocatable public IP → deterministic unknown shelf (country ??)', async () => {
    const a = setup();
    a.tracker.ingest(pkt({ dstIp: '192.0.2.55', host: 'mystery' }));
    await vi.advanceTimersByTimeAsync(300);
    const f1 = opened(a.events)!.flight;
    expect(f1.country).toBe('??');
    expect(f1.city).toBe('Unknown location');
    a.tracker.stop();

    const b = setup();
    b.tracker.ingest(pkt({ dstIp: '192.0.2.55', srcPort: 51000, host: 'mystery' }));
    await vi.advanceTimersByTimeAsync(300);
    const f2 = opened(b.events)!.flight;
    expect(f2.dstLat).toBe(f1.dstLat); // deterministic for the same IP
    expect(f2.dstLng).toBe(f1.dstLng);
    b.tracker.stop();
  });
});

describe('livery precedence (Phase 4 regression)', () => {
  it('process color wins; a later hostname does not overwrite it', async () => {
    mockLookup.mockReturnValue({ process: 'brave', processRaw: 'Brave', pid: 99 });
    // reverse-DNS resolves to a CDN name AFTER the process is already known
    const dns = await import('dns/promises');
    (dns.reverse as Mock).mockResolvedValueOnce(['cdn.fastly.net']);
    const { events, tracker } = setup();
    tracker.ingest(pkt({ dstIp: '203.0.113.7' })); // no host on the packet
    await vi.advanceTimersByTimeAsync(2500);
    expect(opened(events)!.flight.process).toBe('brave');
    expect(opened(events)!.flight.liveryColor).toBe('#FB542B'); // brave, not a hostname hash
    tracker.stop();
  });
});

describe('late aircraft upgrade', () => {
  it('emits an updated patch when volume crosses the cargo threshold', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'big.com', length: 500 }));
    await vi.advanceTimersByTimeAsync(300); // opened as widebody
    tracker.ingest(pkt({ host: 'big.com', length: 11_000_000 })); // > 10MB
    await vi.advanceTimersByTimeAsync(300);
    const upgrade = events.find(
      (e) => e.event === 'updated' && e.patch.aircraftType === 'cargo',
    );
    expect(upgrade).toBeDefined();
    tracker.stop();
  });
});

describe('metric cadence (Phase 8)', () => {
  it('emits metric patches at most once per second per flow', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com', length: 1000 }));
    await vi.advanceTimersByTimeAsync(300); // opened
    // drip data every 250ms for ~3s
    for (let i = 0; i < 12; i++) {
      tracker.ingest(pkt({ host: 'x.com', length: 1000 }));
      await vi.advanceTimersByTimeAsync(250);
    }
    const metricPatches = events.filter(
      (e) => e.event === 'updated' && 'bytesTotal' in e.patch,
    );
    // ~3s of dripping → at most ~3-4 metric patches (1/s), not 12
    expect(metricPatches.length).toBeLessThanOrEqual(5);
    tracker.stop();
  });
});
