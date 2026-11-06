import { describe, it, expect } from 'vitest';
import { parseTcpdumpLine } from '../server/capture';

const LOCAL = new Set(['192.168.1.5', '2001:db8::1']);

describe('parseTcpdumpLine (no -q: Flags visible)', () => {
  it('SYN → no fin/rst, HTTPS by port, outbound', () => {
    const p = parseTcpdumpLine('IP 192.168.1.5.54821 > 142.250.80.46.443: Flags [S], seq 1, win 65535, length 0', LOCAL);
    expect(p!.protocol).toBe('TCP');
    expect(p!.detectedProtocol).toBe('HTTPS');
    expect(p!.tcpFin).toBe(false);
    expect(p!.tcpRst).toBe(false);
    expect(p!.direction).toBe('outbound');
    expect(p!.srcPort).toBe(54821);
    expect(p!.dstPort).toBe(443);
  });

  it('FIN flag → tcpFin true (lets descent fire before the stale timer)', () => {
    const p = parseTcpdumpLine('IP 142.250.80.46.443 > 192.168.1.5.54821: Flags [F.], seq 1, ack 1, win 501, length 0', LOCAL);
    expect(p!.tcpFin).toBe(true);
    expect(p!.tcpRst).toBe(false);
    expect(p!.direction).toBe('inbound');
  });

  it('RST flag → tcpRst true', () => {
    const p = parseTcpdumpLine('IP 142.250.80.46.443 > 192.168.1.5.54821: Flags [R.], seq 1, win 0, length 0', LOCAL);
    expect(p!.tcpRst).toBe(true);
    expect(p!.tcpFin).toBe(false);
  });

  it('PSH ([P.]) → neither fin nor rst; length extracted', () => {
    const p = parseTcpdumpLine('IP 192.168.1.5.5000 > 1.2.3.4.443: Flags [P.], seq 1:1401, length 1400', LOCAL);
    expect(p!.tcpFin).toBe(false);
    expect(p!.tcpRst).toBe(false);
    expect(p!.length).toBe(1400);
  });

  it('UDP line → protocol UDP, port-based detect', () => {
    const p = parseTcpdumpLine('IP 192.168.1.5.51820 > 9.9.9.9.51820: UDP, length 128', LOCAL);
    expect(p!.protocol).toBe('UDP');
    expect(p!.detectedProtocol).toBe('WireGuard');
    expect(p!.length).toBe(128);
  });

  it('verbose DNS line still parses (UDP, port 53 → DNS)', () => {
    const p = parseTcpdumpLine('IP 192.168.1.5.54000 > 8.8.8.8.53: 12345+ A? google.com. (28)', LOCAL);
    expect(p!.protocol).toBe('UDP');
    expect(p!.detectedProtocol).toBe('DNS');
    expect(p!.dstPort).toBe(53);
  });

  it('ICMP echo (portless) → ICMP with ports 0, not dropped', () => {
    const p = parseTcpdumpLine('IP 192.168.1.5 > 8.8.8.8: ICMP echo request, id 1, seq 1, length 64', LOCAL);
    expect(p).not.toBeNull();
    expect(p!.protocol).toBe('ICMP');
    expect(p!.detectedProtocol).toBe('ICMP');
    expect(p!.srcPort).toBe(0);
    expect(p!.dstPort).toBe(0);
    expect(p!.srcIp).toBe('192.168.1.5');
    expect(p!.dstIp).toBe('8.8.8.8');
  });

  it('IPv6 TCP line → isIPv6, ports split correctly', () => {
    const p = parseTcpdumpLine('IP6 2001:db8::1.443 > 2606:2800::1.80: Flags [P.], seq 1:5, length 4', LOCAL);
    expect(p!.isIPv6).toBe(true);
    expect(p!.srcIp).toBe('2001:db8::1');
    expect(p!.dstIp).toBe('2606:2800::1');
    expect(p!.srcPort).toBe(443);
    expect(p!.dstPort).toBe(80);
  });

  it('IPv6 ICMP6 (portless) → ICMP', () => {
    const p = parseTcpdumpLine('IP6 2001:db8::1 > 2606:2800::2: ICMP6, echo request, length 16', LOCAL);
    expect(p!.protocol).toBe('ICMP');
    expect(p!.isIPv6).toBe(true);
    expect(p!.srcPort).toBe(0);
  });

  it('garbage → null, never throws', () => {
    expect(parseTcpdumpLine('total garbage line', LOCAL)).toBeNull();
    expect(parseTcpdumpLine('', LOCAL)).toBeNull();
    expect(() => parseTcpdumpLine('IP weird', LOCAL)).not.toThrow();
  });
});
