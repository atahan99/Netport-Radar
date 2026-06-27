// server/config.ts
// All server tunables in one place. (Frontend tunables live in src/config.ts.)

import { randomBytes } from 'crypto';

export const WS_PORT = 8090;
export const HTTP_PORT = 8080;

// Bind address for both the WS (flight stream + control) and the static HTTP
// server. Loopback by default: this is a single-machine visualizer and the WS
// carries sensitive metadata (process names, SNI hostnames, IPs). Set
// NETPORT_BIND=0.0.0.0 to view from another device — that enables token auth.
export const BIND_HOST = process.env.NETPORT_BIND ?? '127.0.0.1';
export const IS_LOCAL_BIND =
  BIND_HOST === '127.0.0.1' || BIND_HOST === 'localhost' || BIND_HOST === '::1';

// One random token per boot, only when exposed beyond loopback. Loopback mode
// stays tokenless — zero friction for the normal local case.
export const TOKEN: string | null = IS_LOCAL_BIND ? null : randomBytes(16).toString('hex');

// ── Flow tracker / capture timings (ms) ─────────────────────────────────────
export const DNS_HOLD_MS = 2000; // taxi: hold for DNS before launch
export const HOLD_IDLE_MS = 5000; // cruise → hold after this much idle
export const DESCENT_MS = 2000; // FIN/RST → landed after this
export const STALE_MS = 120_000; // force-close a silent flow
export const CLOSED_TTL_MS = 30_000; // drop a closed flow from server memory
export const EMIT_MIN_MS = 1000; // min interval between metric patches per flow
export const TICK_MS = 250; // flow-tracker tick
export const PROCESS_POLL_MS = 2000; // lsof poll interval
export const WS_FLUSH_MS = 100; // WS event-batch flush interval
export const WS_MAX_PAYLOAD = 4096; // max inbound client frame size
