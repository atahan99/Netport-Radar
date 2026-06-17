import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dns/promises', () => ({ reverse: vi.fn().mockRejectedValue(new Error('no dns')) }));
vi.mock('../server/process-names', () => ({
  lookupProcess: vi.fn(() => null),
  startProcessPolling: vi.fn(),
  stopProcessPolling: vi.fn(),
}));

import { parseTsharkLine } from '../server/capture';
import { FlowTracker } from '../server/flow-tracker';
import { logEvent, exportNdjson, resetLog } from '../server/logger';
import type { FlightEvent, HomeAirport } from '../src/types';

const LOCAL = new Set(['192.168.1.5']);
const HOME: HomeAirport = { id: 'primary', label: 'Istanbul', lat: 41, lng: 29, ip: '192.168.1.5', isVpn: false };

function line(f: Record<number, string>): string {
  return Array.from({ length: 15 }, (_, i) => f[i] ?? '').join('\t');
}

// One coherent outbound TCP session: ClientHello with SNI, 3 data packets, FIN.
const SESSION = [
  line({ 0: '192.168.1.5', 1: '93.184.216.34', 4: '50000', 5: '443', 8: 'eth:ip:tcp:tls', 9: '200', 10: 'secure.example.com' }),
  line({ 0: '192.168.1.5', 1: '93.184.216.34', 4: '50000', 5: '443', 8: 'eth:ip:tcp', 9: '1000' }),
  line({ 0: '192.168.1.5', 1: '93.184.216.34', 4: '50000', 5: '443', 8: 'eth:ip:tcp', 9: '1000' }),
  line({ 0: '192.168.1.5', 1: '93.184.216.34', 4: '50000', 5: '443', 8: 'eth:ip:tcp', 9: '1000' }),
  line({ 0: '192.168.1.5', 1: '93.184.216.34', 4: '50000', 5: '443', 8: 'eth:ip:tcp', 9: '0', 13: '1' }),
];

beforeEach(() => {
  vi.useFakeTimers();
  resetLog();
});
afterEach(() => vi.useRealTimers());

describe('end-to-end: tshark lines → parser → flow tracker → logger', () => {
  it('produces one flight with SNI hostname, correct byte total, clean ordering', async () => {
    const events: FlightEvent[] = [];
    const tracker = new FlowTracker({
      getHomeAirports: () => [HOME],
      onEvent: (e) => {
        events.push(e);
        logEvent(e);
      },
      onSourceIp: () => {},
    });

    const ingest = (raw: string) => {
      const p = parseTsharkLine(raw, LOCAL);
      expect(p).not.toBeNull();
      tracker.ingest(p!);
    };

    ingest(SESSION[0]); // ClientHello + SNI
    await vi.advanceTimersByTimeAsync(300); // opens (hostname present)
    ingest(SESSION[1]);
    ingest(SESSION[2]);
    ingest(SESSION[3]);
    await vi.advanceTimersByTimeAsync(300);
    ingest(SESSION[4]); // FIN
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(2100); // descent → closed

    const openedEvents = events.filter((e) => e.event === 'opened');
    expect(openedEvents).toHaveLength(1);
    expect(openedEvents[0].event === 'opened' && openedEvents[0].flight.hostname).toBe('secure.example.com');

    const closed = events.find((e) => e.event === 'closed');
    expect(closed && closed.event === 'closed' && closed.bytesTotal).toBe(3200); // 200 + 1000*3

    // opened comes before closed
    const kinds = events.filter((e) => e.event === 'opened' || e.event === 'closed').map((e) => e.event);
    expect(kinds[0]).toBe('opened');
    expect(kinds[kinds.length - 1]).toBe('closed');

    // NDJSON log: every line is valid JSON with the required keys
    const lines = exportNdjson().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const obj = JSON.parse(l);
      expect(obj).toHaveProperty('t');
      expect(obj).toHaveProperty('e');
      expect(obj).toHaveProperty('id');
    }
    // the opened line carries the resolved hostname
    const openedLine = lines.map((l) => JSON.parse(l)).find((o) => o.e === 'opened');
    expect(openedLine.hostname).toBe('secure.example.com');

    tracker.stop();
  });
});
