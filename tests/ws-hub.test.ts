import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { WsHub, parseClientMessage } from '../server/ws';
import type { BackendInfo, HomeAirport, ServerMessage } from '../src/types';

const HOME: HomeAirport[] = [{ id: 'primary', label: 'Home', lat: 0, lng: 0, ip: '', isVpn: false }];
const BACKEND: BackendInfo = { capture: 'tshark', dpiMode: 'full', iface: 'en0', interfaces: ['en0'] };

let portSeq = 18100;
const hubs: WsHub[] = [];
function makeHub(token: string | null): { hub: WsHub; port: number } {
  const port = portSeq++;
  const hub = new WsHub(port, () => ({ homeAirports: HOME, backend: BACKEND, flights: [] }), {
    host: '127.0.0.1',
    token,
  });
  hubs.push(hub);
  return { hub, port };
}

// Resolve with the first N messages received, or reject if the handshake fails.
function connect(
  port: number,
  opts: { origin?: string; path?: string; want?: number } = {},
): Promise<{ ws: WebSocket; msgs: ServerMessage[] }> {
  const want = opts.want ?? 1;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? ''}`, {
      headers: opts.origin ? { Origin: opts.origin } : {},
    });
    const msgs: ServerMessage[] = [];
    ws.on('message', (d) => {
      msgs.push(JSON.parse(d.toString()) as ServerMessage);
      if (msgs.length >= want) resolve({ ws, msgs });
    });
    ws.on('error', () => reject(new Error('rejected')));
    ws.on('unexpected-response', () => reject(new Error('rejected')));
  });
}

afterEach(() => {
  for (const h of hubs.splice(0)) h.stop();
});

describe('WsHub protocol', () => {
  it('sends init with the provided home + backend on connect', async () => {
    const { port } = makeHub(null);
    const { ws, msgs } = await connect(port);
    expect(msgs[0].type).toBe('init');
    expect(msgs[0]).toMatchObject({ homeAirports: HOME, backend: BACKEND });
    ws.close();
  });

  it('replays the last error to late joiners', async () => {
    const { hub, port } = makeHub(null);
    hub.error('capture_permission', 'needs sudo');
    const { ws, msgs } = await connect(port, { want: 2 });
    expect(msgs[0].type).toBe('init');
    expect(msgs[1]).toMatchObject({ type: 'error', code: 'capture_permission' });
    ws.close();
  });

  it('closes a connection that sends an oversized frame (maxPayload)', async () => {
    const { port } = makeHub(null);
    const { ws } = await connect(port);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.send('x'.repeat(5000)); // > 4096
    expect(await closed).toBe(1009); // message too big
  });
});

describe('WsHub security gate', () => {
  it('loopback mode: no-Origin and localhost Origins allowed, foreign Origin rejected', async () => {
    const { port } = makeHub(null);
    await expect(connect(port)).resolves.toBeDefined(); // no Origin (CLI tools)
    await expect(connect(port, { origin: 'http://localhost:5173' })).resolves.toBeDefined();
    await expect(connect(port, { origin: 'https://evil.example' })).rejects.toThrow('rejected');
  });

  it('token mode: connection requires the boot token', async () => {
    const { port } = makeHub('s3cr3t');
    await expect(connect(port)).rejects.toThrow('rejected'); // no token
    await expect(connect(port, { path: '/?token=wrong' })).rejects.toThrow('rejected');
    await expect(connect(port, { path: '/?token=s3cr3t' })).resolves.toBeDefined();
  });
});

describe('WsHub inbound validation', () => {
  it('parseClientMessage accepts only well-formed messages', () => {
    expect(parseClientMessage('{"type":"export"}')).toEqual({ type: 'export' });
    expect(parseClientMessage('{"type":"switch_iface","iface":"en0"}')).toEqual({
      type: 'switch_iface',
      iface: 'en0',
    });
    for (const bad of [
      'null',
      '[]',
      '{}',
      '42',
      '"x"',
      'not json',
      '{"type":"switch_iface"}',
      '{"type":"switch_iface","iface":123}',
      '{"type":"switch_iface","iface":""}',
      `{"type":"switch_iface","iface":"${'a'.repeat(65)}"}`,
      '{"type":"nope"}',
    ]) {
      expect(parseClientMessage(bad), bad).toBeNull();
    }
  });

  it('survives malformed frames and a throwing handler, and keeps serving clients', async () => {
    const { hub, port } = makeHub(null);
    let calls = 0;
    hub.onClient = () => {
      calls++;
      throw new Error('handler bug');
    };
    const { ws } = await connect(port);
    for (const f of ['null', '{}', '{"type":"switch_iface"}', '{"type":"switch_iface","iface":7}']) {
      ws.send(f);
    }
    ws.send('{"type":"export"}'); // valid → reaches the (throwing) handler
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
    await expect(connect(port)).resolves.toBeDefined();
    ws.close();
  });

  it('stops replaying an error once cleared', async () => {
    const { hub, port } = makeHub(null);
    hub.error('capture_error', 'restarting');
    hub.clearError();
    const { ws, msgs } = await connect(port);
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.map((m) => m.type)).toEqual(['init']);
    ws.close();
  });
});

describe('WsHub backpressure and readiness', () => {
  it('skips a slow client past 1 MB buffered and disconnects it past 8 MB', () => {
    const { hub } = makeHub(null);
    const push = (hub as unknown as { push: (ws: unknown, d: string) => void }).push.bind(hub);
    const mk = (bufferedAmount: number) => ({ readyState: 1, bufferedAmount, send: vi.fn(), terminate: vi.fn() });
    const fast = mk(0), slow = mk(2 << 20), stuck = mk(9 << 20);
    push(fast, 'x'); push(slow, 'x'); push(stuck, 'x');
    expect(fast.send).toHaveBeenCalled();
    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.terminate).not.toHaveBeenCalled();
    expect(stuck.terminate).toHaveBeenCalled();
  });

  it('refuses connections until marked ready', async () => {
    const port = portSeq++;
    const hub = new WsHub(port, () => ({ homeAirports: HOME, backend: BACKEND, flights: [] }), { host: '127.0.0.1', token: null, ready: false });
    hubs.push(hub);
    await expect(connect(port)).rejects.toThrow('rejected');
    hub.markReady();
    await expect(connect(port)).resolves.toBeDefined();
  });
});
