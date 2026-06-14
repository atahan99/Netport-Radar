// server/ws.ts
// WebSocket hub. Server → client only. Batches FlightEvents every 100ms.

import { WebSocketServer, WebSocket } from 'ws';
import type {
  BackendInfo,
  ClientMessage,
  FlightEvent,
  HomeAirport,
  ServerMessage,
} from '../src/types';

export class WsHub {
  private wss: WebSocketServer;
  private queue: FlightEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private lastError: { code: string; message: string } | null = null;
  onClient: ((msg: ClientMessage, reply: (m: ServerMessage) => void) => void) | null = null;

  constructor(
    port: number,
    private getInit: () => { homeAirports: HomeAirport[]; backend: BackendInfo },
  ) {
    this.wss = new WebSocketServer({ port });
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
