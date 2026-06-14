// server/ws.ts
// WebSocket hub. Streams FlightEvents (batched every 100ms) + a tiny control
// channel back. Security gate lives here: loopback binds allow only local
// browser origins (blocks cross-site WebSocket hijack from arbitrary websites —
// browsers don't apply CORS to WS); non-local binds require the boot token.

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type {
  BackendInfo,
  ClientMessage,
  FlightEvent,
  HomeAirport,
  ServerMessage,
} from '../src/types';

export interface WsHubOpts {
  host: string;
  token: string | null; // null = loopback mode (origin check only)
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const rejectedOrigins = new Set<string>(); // log each offender once

function verifyClient(
  opts: WsHubOpts,
  info: { origin?: string; req: IncomingMessage },
): boolean {
  if (opts.token !== null) {
    // Exposed beyond loopback: the token is the only gate. Origin headers are
    // browser-controlled and can be forged by non-browser LAN clients.
    const url = new URL(info.req.url ?? '/', 'ws://x');
    return url.searchParams.get('token') === opts.token;
  }
  // Loopback: reachable only from this machine. Remaining threat is a hostile
  // website in the user's own browser — so require a local Origin. No Origin
  // header (node scripts, CLI tools) is fine: same-user local processes.
  const origin = info.origin;
  if (!origin) return true;
  try {
    if (LOCAL_HOSTNAMES.has(new URL(origin).hostname)) return true;
  } catch {
    /* malformed origin → reject */
  }
  if (!rejectedOrigins.has(origin)) {
    rejectedOrigins.add(origin);
    console.warn(`[security] rejected WS connection from origin ${origin}`);
  }
  return false;
}

export class WsHub {
  private wss: WebSocketServer;
  private queue: FlightEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private lastError: { code: string; message: string } | null = null;
  onClient: ((msg: ClientMessage, reply: (m: ServerMessage) => void) => void) | null = null;

  constructor(
    port: number,
    private getInit: () => { homeAirports: HomeAirport[]; backend: BackendInfo },
    opts: WsHubOpts,
  ) {
    this.wss = new WebSocketServer({
      port,
      host: opts.host,
      maxPayload: 4096, // ClientMessage is tiny; bound hostile frames
      verifyClient: (info: { origin?: string; req: IncomingMessage }) =>
        verifyClient(opts, info),
    });
    // Belt-and-suspenders: the preflight in index.ts catches a busy port, but
    // guard the 'error' event too so a late EADDRINUSE can't crash uncaught.
    this.wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[fatal] WS port ${port} is already in use.`);
        process.exit(1);
      }
      console.error('[ws]', err.message);
    });
    this.wss.on('connection', (ws) => {
      const { homeAirports, backend } = this.getInit();
      this.sendTo(ws, { type: 'init', homeAirports, backend });
      if (this.lastError) this.sendTo(ws, { type: 'error', ...this.lastError });
      ws.on('message', (data) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(data.toString()) as ClientMessage;
        } catch {
          return;
        }
        this.onClient?.(msg, (reply) => this.sendTo(ws, reply));
      });
    });
    this.flushTimer = setInterval(() => this.flush(), 100);
  }

  enqueue(e: FlightEvent): void {
    this.queue.push(e);
  }

  homeUpdate(homeAirports: HomeAirport[]): void {
    this.broadcast({ type: 'home_update', homeAirports });
  }

  broadcastInit(): void {
    const { homeAirports, backend } = this.getInit();
    this.broadcast({ type: 'init', homeAirports, backend });
  }

  reset(): void {
    this.broadcast({ type: 'reset' });
  }

  error(code: string, message: string): void {
    this.lastError = { code, message };
    this.broadcast({ type: 'error', code, message });
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    this.broadcast({ type: 'batch', events });
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  stop(): void {
    clearInterval(this.flushTimer);
    this.wss.close();
  }
}
