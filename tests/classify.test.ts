import { describe, it, expect } from 'vitest';
import { classify, protocolFamily } from '../src/lib/classify';
import type { DetectedProtocol } from '../src/types';

/** Realistic capture-shaped scenarios for threshold sanity. */
const CAPTURE_FIXTURES: Array<{
  label: string;
  protocol: DetectedProtocol;
  bytes: number;
  ms: number;
  aircraft: ReturnType<typeof classify>;
}> = [
  { label: 'browser tab burst', protocol: 'HTTPS', bytes: 800_000, ms: 4_000, aircraft: 'widebody' },
  { label: 'API poll', protocol: 'HTTPS', bytes: 50_000, ms: 30_000, aircraft: 'widebody' },
  { label: 'game patch download', protocol: 'TCP', bytes: 25_000_000, ms: 45_000, aircraft: 'cargo' },
  { label: 'cloud backup stream', protocol: 'HTTPS', bytes: 120_000_000, ms: 90_000, aircraft: 'satellite' },
  { label: 'video call WebRTC', protocol: 'WebRTC', bytes: 40_000_000, ms: 600_000, aircraft: 'broadcast' },
  { label: 'WireGuard tunnel', protocol: 'WireGuard', bytes: 500_000_000, ms: 3_600_000, aircraft: 'privatejet' },
  { label: 'DoH resolver', protocol: 'DoH', bytes: 2_000, ms: 50, aircraft: 'drone' },
  { label: 'SSH bastion', protocol: 'SSH', bytes: 5_000_000, ms: 300_000, aircraft: 'stealth' },
  { label: 'ICMP ping', protocol: 'ICMP', bytes: 128, ms: 1, aircraft: 'ambulance' },
  { label: 'Steam gaming UDP', protocol: 'Steam', bytes: 8_000_000, ms: 20_000, aircraft: 'helicopter' },
];

describe('classify protocol → aircraft', () => {
  it('maps the protocol families', () => {
    expect(classify('WireGuard', 0, 0)).toBe('privatejet');
    expect(classify('OpenVPN', 0, 0)).toBe('privatejet');
    expect(classify('DNS', 0, 0)).toBe('drone');
    expect(classify('DoH', 0, 0)).toBe('drone');
    expect(classify('RTMP', 0, 0)).toBe('broadcast');
    expect(classify('ICMP', 0, 0)).toBe('ambulance');
    expect(classify('ICMPv6', 0, 0)).toBe('ambulance');
    expect(classify('SSH', 0, 0)).toBe('stealth');
    expect(classify('QUIC', 0, 0)).toBe('helicopter');
    expect(classify('HTTP', 0, 0)).toBe('narrowbody');
    expect(classify('UDP', 0, 0)).toBe('helicopter');
  });

  it('HTTPS/TCP volume thresholds: widebody → cargo → satellite', () => {
    expect(classify('HTTPS', 0, 0)).toBe('widebody');
    expect(classify('HTTPS', 10_000_000, 0)).toBe('widebody'); // boundary: not > 10MB
    expect(classify('HTTPS', 10_000_001, 0)).toBe('cargo');
    expect(classify('TCP', 50_000_000, 0)).toBe('cargo');
    // satellite needs BOTH >100MB AND >60s
    expect(classify('HTTPS', 200_000_000, 30_000)).toBe('cargo'); // high volume, short → not satellite
    expect(classify('HTTPS', 50_000_000, 120_000)).toBe('cargo'); // long but < 100MB → not satellite
    expect(classify('HTTPS', 200_000_000, 120_000)).toBe('satellite');
  });
});

describe('capture fixtures', () => {
  it.each(CAPTURE_FIXTURES)('$label → $aircraft', ({ protocol, bytes, ms, aircraft }) => {
    expect(classify(protocol, bytes, ms)).toBe(aircraft);
  });
});

describe('protocolFamily', () => {
  it('buckets each protocol into its filter family', () => {
    const cases: Array<[DetectedProtocol, string]> = [
      ['WireGuard', 'vpn'],
      ['DNS', 'dns'],
      ['DoQ', 'dns'],
      ['RTMP', 'stream'],
      ['SSH', 'ssh'],
      ['QUIC', 'quic'],
      ['HTTP', 'http'],
      ['HTTPS', 'https'],
      ['ICMP', 'icmp'],
      ['UDP', 'udp'],
      ['TCP', 'tcp'],
    ];
    for (const [proto, fam] of cases) expect(protocolFamily(proto), proto).toBe(fam);
  });
});
