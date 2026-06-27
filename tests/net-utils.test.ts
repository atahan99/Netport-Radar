import { describe, it, expect } from 'vitest';
import {
  isPrivate,
  isMulticast,
  isLoopback,
  isCgnat,
  lanCity,
  flagEmoji,
  callsign,
  resetCallsigns,
  ipv6Prefix64,
  canonicalHost,
} from '../server/net-utils';

describe('isPrivate', () => {
  it('matches RFC1918 + link-local + CGNAT + benchmarking + IPv6 ULA', () => {
    for (const ip of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '100.127.0.1', '198.18.0.1', 'fe80::1', 'fc00::1', 'fd12::1']) {
      expect(isPrivate(ip), ip).toBe(true);
    }
  });
  it('rejects public / boundary addresses', () => {
    for (const ip of ['8.8.8.8', '100.63.0.1', '100.128.0.1', '172.15.0.1', '172.32.0.1', '11.0.0.1', '2606:2800::1']) {
      expect(isPrivate(ip), ip).toBe(false);
    }
  });
});

describe('isCgnat', () => {
  it('only 100.64.0.0/10', () => {
    expect(isCgnat('100.64.0.1')).toBe(true);
    expect(isCgnat('100.127.255.255')).toBe(true);
    expect(isCgnat('100.63.0.1')).toBe(false);
    expect(isCgnat('100.128.0.1')).toBe(false);
  });
});

describe('isMulticast', () => {
  it('matches 224–239, ff00::/8, broadcast; rejects unicast', () => {
    expect(isMulticast('224.0.0.1')).toBe(true);
    expect(isMulticast('239.255.255.250')).toBe(true);
    expect(isMulticast('255.255.255.255')).toBe(true);
    expect(isMulticast('ff02::fb')).toBe(true);
    expect(isMulticast('8.8.8.8')).toBe(false);
    expect(isMulticast('223.0.0.1')).toBe(false);
    expect(isMulticast('240.0.0.1')).toBe(false);
  });
});

describe('isLoopback', () => {
  it('matches 127/8 and ::1', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('8.8.8.8')).toBe(false);
  });
});

describe('lanCity', () => {
  it('labels CGNAT, benchmarking, and generic LAN', () => {
    expect(lanCity('100.100.0.1')).toBe('Tailscale / CGNAT');
    expect(lanCity('198.18.0.1')).toBe('Test range');
    expect(lanCity('192.168.1.1')).toBe('Local network');
  });
});

describe('flagEmoji', () => {
  it('converts a 2-letter code, rejects junk', () => {
    expect(flagEmoji('TR')).toBe('🇹🇷');
    expect(flagEmoji('us')).toBe('🇺🇸');
    expect(flagEmoji('XYZ')).toBe('');
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('1')).toBe('');
  });
});

describe('callsign', () => {
  it('10k generations: all unique, 6-hex, prefix from protocol', () => {
    resetCallsigns();
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const cs = callsign('HTTPS');
      expect(cs).toMatch(/^HTT-[0-9A-F]{6}$/);
      seen.add(cs);
    }
    expect(seen.size).toBe(10_000);
  });
  it('falls back to NET prefix for empty/non-alpha protocol', () => {
    expect(callsign('')).toMatch(/^NET-[0-9A-F]{6}$/);
    expect(callsign('123')).toMatch(/^NET-[0-9A-F]{6}$/);
  });
});

describe('ipv6Prefix64', () => {
  it('normalizes compressed and expanded forms to the same /64', () => {
    expect(ipv6Prefix64('2001:db8::1')).toBe('2001:0db8:0000:0000');
    expect(ipv6Prefix64('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:0db8:0000:0000');
    expect(ipv6Prefix64('2606:2800:220:1::')).toBe('2606:2800:0220:0001');
  });
});

describe('canonicalHost', () => {
  it('rejects IPs, PTR noise, and empty hosts', () => {
    expect(canonicalHost('8.8.8.8', '8.8.8.8')).toBeUndefined();
    expect(canonicalHost('4.4.8.8.in-addr.arpa', '8.8.4.4')).toBeUndefined();
    expect(canonicalHost(undefined, '1.2.3.4')).toBeUndefined();
    expect(canonicalHost('dns.google.', '8.8.8.8')).toBe('dns.google');
  });
});
