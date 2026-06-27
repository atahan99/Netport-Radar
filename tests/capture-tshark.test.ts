import { describe, it, expect } from 'vitest';
import { parseTsharkLine, detectFromFrameProtos, portBasedDetect } from '../server/capture';

const LOCAL = new Set(['192.168.1.5', '2001:db8::1']);

// Build a tshark "-T fields" tab line in the exact TSHARK_FIELDS order:
// 0 ip.src · 1 ip.dst · 2 ipv6.src · 3 ipv6.dst · 4 tcp.srcport · 5 tcp.dstport
// 6 udp.srcport · 7 udp.dstport · 8 frame.protocols · 9 frame.len
// 10 tls SNI · 11 dns.qry.name · 12 http.host · 13 tcp.flags.fin · 14 tcp.flags.reset
function line(f: Record<number, string>): string {
  return Array.from({ length: 15 }, (_, i) => f[i] ?? '').join('\t');
}

describe('parseTsharkLine', () => {
  it('parses IPv4 TLS with SNI → HTTPS, outbound, host=SNI', () => {
    const p = parseTsharkLine(
      line({ 0: '192.168.1.5', 1: '142.250.0.1', 4: '54000', 5: '443', 8: 'eth:ip:tcp:tls', 9: '200', 10: 'www.google.com' }),
      LOCAL,
    );
    expect(p).not.toBeNull();
    expect(p!.detectedProtocol).toBe('HTTPS');
    expect(p!.host).toBe('www.google.com');
    expect(p!.direction).toBe('outbound');
    expect(p!.isIPv6).toBe(false);
    expect(p!.srcPort).toBe(54000);
    expect(p!.dstPort).toBe(443);
  });

  it('uses DNS query name when there is no SNI', () => {
    const p = parseTsharkLine(
      line({ 0: '192.168.1.5', 1: '8.8.8.8', 6: '5000', 7: '53', 8: 'eth:ip:udp:dns', 11: 'example.com' }),
      LOCAL,
    );
    expect(p!.detectedProtocol).toBe('DNS');
    expect(p!.protocol).toBe('UDP');
    expect(p!.host).toBe('example.com');
  });

  it('falls back SNI → http.host → dns name', () => {
    const httpHost = parseTsharkLine(
      line({ 0: '192.168.1.5', 1: '1.2.3.4', 4: '5', 5: '80', 8: 'eth:ip:tcp:http', 12: 'plain.example' }),
      LOCAL,
    );
    expect(httpHost!.detectedProtocol).toBe('HTTP');
    expect(httpHost!.host).toBe('plain.example');
  });

  it('uses IPv6 columns when IPv4 empty; sets isIPv6 + inbound', () => {
    const p = parseTsharkLine(
      line({ 2: '2606:2800::1', 3: '2001:db8::1', 4: '443', 5: '40000', 8: 'eth:ipv6:tcp:tls', 9: '60' }),
      LOCAL,
    );
    expect(p!.srcIp).toBe('2606:2800::1');
    expect(p!.dstIp).toBe('2001:db8::1');
    expect(p!.isIPv6).toBe(true);
    expect(p!.direction).toBe('inbound'); // src not in LOCAL
  });

  it('maps FIN / RST flags', () => {
    const fin = parseTsharkLine(line({ 0: '192.168.1.5', 1: '1.2.3.4', 4: '5', 5: '443', 8: 'eth:ip:tcp', 13: '1' }), LOCAL);
    const rst = parseTsharkLine(line({ 0: '192.168.1.5', 1: '1.2.3.4', 4: '5', 5: '443', 8: 'eth:ip:tcp', 14: '1' }), LOCAL);
    expect(fin!.tcpFin).toBe(true);
    expect(fin!.tcpRst).toBe(false);
    expect(rst!.tcpRst).toBe(true);
  });

  it('returns null for empty / header-less lines and never throws on garbage', () => {
    expect(parseTsharkLine('', LOCAL)).toBeNull();
    expect(parseTsharkLine('\t\t\t\t', LOCAL)).toBeNull(); // no src/dst
    expect(() => parseTsharkLine('total\tgarbage\twith\tno\tstructure', LOCAL)).not.toThrow();
  });

  it('handles a short line (missing trailing fields)', () => {
    const p = parseTsharkLine('192.168.1.5\t1.2.3.4', LOCAL); // only 2 fields
    expect(p).not.toBeNull();
    expect(p!.tcpFin).toBe(false);
    expect(p!.host).toBeUndefined();
  });
});

describe('detectFromFrameProtos precedence', () => {
  const d = (protos: string, port = 0) => detectFromFrameProtos(protos, port).detectedProtocol;

  it('VPN beats TLS beats TCP', () => {
    expect(d('eth:ip:udp:wireguard')).toBe('WireGuard');
    expect(d('eth:ip:tcp:openvpn')).toBe('OpenVPN');
    expect(d('eth:ip:tcp:tls')).toBe('HTTPS');
    expect(d('eth:ip:tcp')).toBe('TCP');
  });

  it('QUIC vs DoQ; DoH; mdns; ssh; http2/3 → HTTPS; icmpv6 before icmp', () => {
    expect(d('eth:ip:udp:quic')).toBe('QUIC');
    expect(d('eth:ip:udp:quic:dns')).toBe('DoQ');
    expect(d('eth:ip:tcp:tls:http2:dns')).toBe('DoH');
    expect(d('eth:ip:udp:mdns')).toBe('mDNS');
    expect(d('eth:ip:tcp:ssh')).toBe('SSH');
    expect(d('eth:ip:tcp:http3')).toBe('HTTPS');
    expect(d('eth:ipv6:icmpv6')).toBe('ICMPv6');
    expect(d('eth:ip:icmp')).toBe('ICMP');
  });

  it('sets transport protocol correctly', () => {
    expect(detectFromFrameProtos('eth:ip:udp:quic').protocol).toBe('UDP');
    expect(detectFromFrameProtos('eth:ip:icmp').protocol).toBe('ICMP');
    expect(detectFromFrameProtos('eth:ip:tcp:tls').protocol).toBe('TCP');
  });
});

describe('portBasedDetect', () => {
  it('maps well-known ports', () => {
    expect(portBasedDetect('UDP', 53)).toBe('DNS');
    expect(portBasedDetect('TCP', 853)).toBe('DoT');
    expect(portBasedDetect('UDP', 853)).toBe('DoQ');
    expect(portBasedDetect('UDP', 51820)).toBe('WireGuard');
    expect(portBasedDetect('TCP', 22)).toBe('SSH');
    expect(portBasedDetect('TCP', 1935)).toBe('RTMP');
    expect(portBasedDetect('UDP', 443)).toBe('QUIC');
    expect(portBasedDetect('TCP', 443)).toBe('HTTPS');
    expect(portBasedDetect('TCP', 80)).toBe('HTTP');
    expect(portBasedDetect('TCP', 12345)).toBe('TCP');
  });
});
