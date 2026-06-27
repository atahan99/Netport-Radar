// server/ws.ts
// WebSocket hub. Server → client only. Batches FlightEvents every 100ms.

import { WebSocketServer, WebSocket } from 'ws';
import type { BackendInfo, FlightEvent, HomeAirport, ServerMessage } from '../src/types';

export class WsHub {
  private wss: WebSocketServer;
  private queue: FlightEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private lastError: { code: string; message: string } | null = null;

  constructor(
    port: number,
    private getInit: () => { homeAirports: HomeAirport[]; backend: BackendInfo },
  ) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => {
      const { homeAirports, backend } = this.getInit();
      this.sendTo(ws, { type: 'init', homeAirports, backend });
      if (this.lastError) this.sendTo(ws, { type: 'error', ...this.lastError });
    });
    this.flushTimer = setInterval(() => this.flush(), 100);
  }

  enqueue(e: FlightEvent): void {
    this.queue.push(e);
  }

  homeUpdate(homeAirports: HomeAirport[]): void {
    this.broadcast({ type: 'home_update', homeAirports });
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
