import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startPcapReceiver } from '../server/pcap-socket';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'netport-pcap-'));
  const path = join(dir, 'pcap.sock');
  const got: string[] = [];
  const server = await startPcapReceiver(path, 'n0nce', (sock) => {
    let buf = '';
    sock.on('data', (d) => (buf += d.toString()));
    sock.on('end', () => got.push(buf));
    sock.resume(); // the receiver hands over a paused socket (pipe() resumes it)
  });
  cleanups.push(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { path, got };
}

function sendAndClose(path: string, payload: string): Promise<void> {
  return new Promise((resolve) => {
    const c = net.createConnection(path, () => c.end(payload));
    c.on('close', () => resolve());
    c.on('error', () => resolve());
  });
}

describe('startPcapReceiver', () => {
  it('passes the stream (minus the nonce line) to onStream', async () => {
    const { path, got } = await setup();
    await sendAndClose(path, 'n0nce\nPCAPDATA');
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual(['PCAPDATA']);
  });

  it('drops connections with a wrong or missing nonce', async () => {
    const { path, got } = await setup();
    await sendAndClose(path, 'wrong\nPCAPDATA');
    await sendAndClose(path, 'x'.repeat(500));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([]);
  });
});

describe('startDecoder (tcpdump text over the broker socket)', () => {
  it('parses lines from a paused stream', async () => {
    const { PassThrough } = await import('stream');
    const { startDecoder } = await import('../server/capture');
    const input = new PassThrough();
    input.pause();
    const pkts: unknown[] = [];
    startDecoder('tcpdump', input, new Set(['10.2.0.2']), (p) => pkts.push(p), () => {});
    input.write('IP 10.2.0.2.50382 > 160.79.104.10.443: Flags [S], seq 1, win 2048, length 0\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(pkts).toHaveLength(1);
  });
});
