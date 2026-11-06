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
export const PROCESS_POLL_MS = 2000; // lsof poll interval (idle cadence)
export const PROCESS_POLL_BOOST_MS = 1000; // boosted cadence while flows are unattributed
export const PROCESS_BOOST_WINDOW_MS = 6000; // how long a miss keeps the boost active
export const PROCESS_POLL_MIN_MS = 750; // min gap between polls (immediate-poll debounce)
export const PROCESS_RETAIN_MS = 3000; // keep lsof rows after socket close (sub-poll flows)
export const WS_FLUSH_MS = 100; // WS event-batch flush interval
export const WS_MAX_PAYLOAD = 4096; // max inbound client frame size

// ── Resource bounds (hostile traffic must not grow memory/CPU without limit) ──
export const MAX_FLOWS = 4000; // tracked flows; beyond this, new flows are dropped
export const MAX_PTR_INFLIGHT = 32; // concurrent reverse-DNS lookups
export const WS_SKIP_BUFFERED = 1 << 20; // skip a slow client's batches above 1 MB buffered
export const WS_DROP_BUFFERED = 8 << 20; // disconnect it above 8 MB
