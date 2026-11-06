// server/pcap-socket.ts
// Receiving end of the broker's pcap streams. Listens on a Unix socket inside a
// private 0700 directory; every connection must open with the per-boot nonce
// line, otherwise it's dropped before any byte reaches a decoder.

import net from 'net';
import { timingSafeEqual } from 'crypto';

const MAX_PREAMBLE = 128;

export function startPcapReceiver(
  path: string,
  nonce: string,
  onStream: (sock: net.Socket) => void,
): Promise<net.Server> {
  const expected = Buffer.from(nonce);
  const server = net.createServer((sock) => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const nl = head.indexOf(0x0a);
      if (nl < 0) {
        if (head.length > MAX_PREAMBLE) sock.destroy();
        return;
      }
      const given = head.subarray(0, nl);
      sock.removeListener('data', onData);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        sock.destroy();
        return;
      }
      sock.pause();
      const rest = head.subarray(nl + 1);
      if (rest.length) sock.unshift(rest);
      onStream(sock);
    };
    sock.on('data', onData);
    sock.on('error', () => {});
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve(server));
  });
}
