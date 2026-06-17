import { describe, it, expect } from 'vitest';
import { classify, protocolFamily } from '../src/lib/classify';
import type { DetectedProtocol } from '../src/types';

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
