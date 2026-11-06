import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Keep reverse-DNS + process lookup off the network / OS so tests are hermetic.
vi.mock('dns/promises', () => ({ reverse: vi.fn().mockRejectedValue(new Error('no dns')) }));
vi.mock('../server/process-names', () => ({
  lookupProcess: vi.fn(() => null),
  startProcessPolling: vi.fn(),
  stopProcessPolling: vi.fn(),
  noteLookupMiss: vi.fn(),
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

describe('IPv4/IPv6 flow merge', () => {
  it('merges v4 and v6 packets to the same hostname into one flight', async () => {
    const { events, tracker } = setup();
    tracker.ingest(
      pkt({
        dstIp: '142.250.80.46',
        srcPort: 51000,
        host: 'dns.google',
        length: 200,
      }),
    );
    tracker.ingest(
      pkt({
        dstIp: '2001:4860:4860::8888',
        srcPort: 52000,
        isIPv6: true,
        host: 'dns.google',
        length: 300,
      }),
    );
    await vi.advanceTimersByTimeAsync(300);
    const opens = events.filter((e) => e.event === 'opened');
    expect(opens).toHaveLength(1);
    const f = opens[0].flight;
    expect(f.bytesTotal).toBe(500);
    expect(f.isIPv6).toBe(true);
    tracker.stop();
  });

  it('merges IPv6 addresses in the same /64 without a hostname', async () => {
    const { events, tracker } = setup();
    tracker.ingest(
      pkt({
        dstIp: '2001:db8:1::1',
        srcPort: 53000,
        isIPv6: true,
        length: 100,
      }),
    );
    tracker.ingest(
      pkt({
        dstIp: '2001:db8:1::2',
        srcPort: 53000,
        isIPv6: true,
        length: 150,
      }),
    );
    await vi.advanceTimersByTimeAsync(2500);
    const opens = events.filter((e) => e.event === 'opened');
    expect(opens).toHaveLength(1);
    expect(opens[0].flight.bytesTotal).toBe(250);
    tracker.stop();
  });
});

describe('process attribution boost (adaptive lsof cadence)', () => {
  it('signals onProcessMiss while a young flow is unattributed', async () => {
    const misses = vi.fn();
    const { tracker } = setup({ onProcessMiss: misses });
    tracker.ingest(pkt({ host: 'x.com' }));
    await vi.advanceTimersByTimeAsync(600);
    expect(misses).toHaveBeenCalled();
    tracker.stop();
  });

  it('signals only once per flow — each new flow notes its own first miss', async () => {
    const misses = vi.fn();
    const { tracker } = setup({ onProcessMiss: misses });
    tracker.ingest(pkt({ host: 'x.com' }));
    await vi.advanceTimersByTimeAsync(2000); // many ticks inside the miss window
    expect(misses).toHaveBeenCalledTimes(1);
    tracker.ingest(pkt({ srcPort: 51111, host: 'y.com' })); // second flow → its own first miss
    expect(misses).toHaveBeenCalledTimes(2);
    tracker.stop();
  });

  it('stops signaling once the flow is past the miss window', async () => {
    const misses = vi.fn();
    const { tracker } = setup({ onProcessMiss: misses });
    tracker.ingest(pkt({ host: 'x.com' }));
    await vi.advanceTimersByTimeAsync(6000); // beyond PROCESS_MISS_WINDOW_MS
    const callsAtWindowEnd = misses.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(misses.mock.calls.length).toBe(callsAtWindowEnd);
    tracker.stop();
  });

  it('never signals when the process resolves immediately', async () => {
    mockLookup.mockReturnValue({ process: 'brave', processRaw: 'Brave', pid: 99 });
    const misses = vi.fn();
    const { tracker } = setup({ onProcessMiss: misses });
    tracker.ingest(pkt({ host: 'x.com' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(misses).not.toHaveBeenCalled();
    tracker.stop();
  });
});

describe('flow lookup (indexed findFlow)', () => {
  it('routes a hostless packet on the same literal 5-tuple to the host-keyed flow', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com', length: 100 })); // stored under its host key
    tracker.ingest(pkt({ length: 200 })); // same 5-tuple, no SNI → literal-tuple hit
    await vi.advanceTimersByTimeAsync(300);
    const opens = events.filter((e) => e.event === 'opened');
    expect(opens).toHaveLength(1);
    expect(opens[0].flight.bytesTotal).toBe(300);
    tracker.stop();
  });

  it('merges connections on different local ports to the same SNI into one flight', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ srcPort: 50000, host: 'cdn.example.com', length: 100 }));
    tracker.ingest(pkt({ srcPort: 50001, host: 'cdn.example.com', length: 150 }));
    await vi.advanceTimersByTimeAsync(300);
    const opens = events.filter((e) => e.event === 'opened');
    expect(opens).toHaveLength(1);
    expect(opens[0].flight.bytesTotal).toBe(250);
    tracker.stop();
  });

  it('absorbFlow removes the absorbed flow and merges its bytes into the keeper', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ srcPort: 50000, dstIp: '1.1.1.1', host: 'x.com', length: 100 })); // keeper
    tracker.ingest(pkt({ srcPort: 50001, dstIp: '5.6.7.8', length: 200 })); // literal-keyed, no SNI
    await vi.advanceTimersByTimeAsync(2100); // both open (DNS hold passes for the second)
    const opens = events.filter((e) => e.event === 'opened');
    expect(opens).toHaveLength(2);
    const keeperId = opens[0].flight.id;
    const absorbedId = opens[1].flight.id;

    // SNI finally shows up on the second tuple → rekey collides → absorbed into keeper
    tracker.ingest(pkt({ srcPort: 50001, dstIp: '5.6.7.8', host: 'x.com', length: 50 }));
    const closed = events.filter((e) => e.event === 'closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe(absorbedId);

    await vi.advanceTimersByTimeAsync(1300); // let a metric patch flush
    const metric = events.filter(
      (e): e is Extract<FlightEvent, { event: 'updated' }> =>
        e.event === 'updated' && 'bytesTotal' in e.patch,
    );
    expect(metric.filter((e) => e.id === keeperId).at(-1)?.patch.bytesTotal).toBe(350);

    // the absorbed tuple is NOT repointed to the keeper — a new packet there starts a fresh flow
    tracker.ingest(pkt({ srcPort: 50001, dstIp: '5.6.7.8', length: 10 }));
    await vi.advanceTimersByTimeAsync(2100);
    expect(events.filter((e) => e.event === 'opened')).toHaveLength(3);
    tracker.stop();
  });

  it('tryRekeyByHostname moves a flow to its host key so later connections merge', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ srcPort: 50000, length: 100 })); // no SNI → literal key
    await vi.advanceTimersByTimeAsync(2100); // opened
    tracker.ingest(pkt({ srcPort: 50000, host: 'x.com', length: 50 })); // SNI arrives → rekeyed
    tracker.ingest(pkt({ srcPort: 50002, host: 'x.com', length: 25 })); // new port, same host → merges
    await vi.advanceTimersByTimeAsync(1300);
    expect(events.filter((e) => e.event === 'opened')).toHaveLength(1);
    const metric = events.filter(
      (e): e is Extract<FlightEvent, { event: 'updated' }> =>
        e.event === 'updated' && 'bytesTotal' in e.patch,
    );
    expect(metric.at(-1)?.patch.bytesTotal).toBe(175);
    tracker.stop();
  });

  it('closed flows do not receive new packets and do not reopen', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com', length: 100 }));
    await vi.advanceTimersByTimeAsync(300); // opened
    tracker.ingest(pkt({ tcpFin: true, length: 0 }));
    await vi.advanceTimersByTimeAsync(2600); // descent → closed
    expect(events.some((e) => e.event === 'closed')).toBe(true);

    const before = events.length;
    tracker.ingest(pkt({ host: 'x.com', length: 500 })); // still in the map, but closed → ignored
    await vi.advanceTimersByTimeAsync(1300);
    expect(events.filter((e) => e.event === 'opened')).toHaveLength(1);
    expect(events.slice(before).filter((e) => e.event === 'updated')).toHaveLength(0);
    tracker.stop();
  });
});

describe('throughput ring (bytesPerSec)', () => {
  it('computes bytesPerSec from the rolling 3s window and decays to 0 when idle', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ host: 'x.com', length: 1000 }));
    await vi.advanceTimersByTimeAsync(300); // opened
    // steady drip: 1000 bytes every 250ms for ~4s (17KB total)
    for (let i = 0; i < 16; i++) {
      tracker.ingest(pkt({ host: 'x.com', length: 1000 }));
      await vi.advanceTimersByTimeAsync(250);
    }
    const metric = () =>
      events.filter(
        (e): e is Extract<FlightEvent, { event: 'updated' }> =>
          e.event === 'updated' && typeof e.patch.bytesPerSec === 'number',
      );
    // window holds ~12 buckets × 1000B → ~4000 B/s, never the cumulative total
    const steady = metric().at(-1)!.patch.bytesPerSec!;
    expect(steady).toBeGreaterThanOrEqual(3000);
    expect(steady).toBeLessThanOrEqual(4100);

    await vi.advanceTimersByTimeAsync(4000); // idle > 3s window → ring zeroes out
    expect(metric().at(-1)!.patch.bytesPerSec).toBe(0);
    tracker.stop();
  });
});

describe('geo confidence', () => {
  it('marks country-only geoip-lite hits as low confidence', async () => {
    const { events, tracker } = setup();
    // 8.8.8.8 geolocates via bundled geoip-lite (country at minimum)
    tracker.ingest(pkt({ dstIp: '8.8.8.8', host: 'dns.google' }));
    await vi.advanceTimersByTimeAsync(300);
    const f = opened(events)!.flight;
    expect(['city', 'country']).toContain(f.geoConfidence);
    tracker.stop();
  });

  it('unknown shelf uses geoConfidence none', async () => {
    const { events, tracker } = setup();
    tracker.ingest(pkt({ dstIp: '192.0.2.55', host: 'mystery' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(opened(events)!.flight.geoConfidence).toBe('none');
    tracker.stop();
  });
});

describe('snapshot (init state for reconnecting clients)', () => {
  it('includes opened flows only, and drops them once closed', async () => {
    const { tracker } = setup();
    tracker.ingest(pkt());
    expect(tracker.snapshot()).toHaveLength(0); // still in the DNS hold, never announced
    await vi.advanceTimersByTimeAsync(2500);
    expect(tracker.snapshot().map((f) => f.dstIp)).toEqual(['8.8.8.8']);
    tracker.ingest(pkt({ tcpFin: true }));
    await vi.advanceTimersByTimeAsync(2600); // descent → landed
    expect(tracker.snapshot()).toHaveLength(0);
    tracker.stop();
  });
});
