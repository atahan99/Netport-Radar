import { describe, it, expect } from 'vitest';
import { validateBrokerInit, IFACE_RE } from '../server/broker-protocol';

const ok = { backend: 'tshark', iface: 'en0', sockPath: '/tmp/x/pcap.sock', nonce: 'abc' };

describe('validateBrokerInit (root broker input)', () => {
  it('accepts a well-formed init', () => {
    expect(validateBrokerInit(ok, true)).toBeNull();
  });
  it('rejects unknown backends, odd interface names and missing fields', () => {
    expect(validateBrokerInit({ ...ok, backend: 'nmap' }, true)).toBe('invalid init');
    for (const iface of ['-w/etc/passwd', '', 'a'.repeat(65), 'en0; rm -rf /', 'en 0']) {
      expect(validateBrokerInit({ ...ok, iface }, true), iface).toBe('invalid init');
    }
    expect(validateBrokerInit({ ...ok, sockPath: 7 }, true)).toBe('invalid init');
    expect(validateBrokerInit({ backend: 'tshark' }, true)).toBe('invalid init');
  });
  it('refuses tcpdump when there is no non-root user to drop to', () => {
    expect(validateBrokerInit({ ...ok, backend: 'tcpdump' }, false)).toMatch(/refusing to dissect as root/);
    expect(validateBrokerInit({ ...ok, backend: 'tcpdump' }, true)).toBeNull();
  });
  it('accepts real interface names', () => {
    for (const n of ['en0', 'utun4', 'eth0.100', 'br-abc123', 'wg0', 'wlp2s0']) expect(IFACE_RE.test(n), n).toBe(true);
  });
});
