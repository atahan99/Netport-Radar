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
