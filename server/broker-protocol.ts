// server/broker-protocol.ts
// Checks the root broker applies to messages from the unprivileged parent.
// Side-effect free (priv-broker.ts registers IPC handlers on import).

import type { CaptureBackend } from './capture';

export const IFACE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const BACKENDS: ReadonlySet<string> = new Set<CaptureBackend>(['tshark', 'tcpdump', 'pcap']);

export interface BrokerInitMsg {
  backend?: unknown;
  iface?: unknown;
  sockPath?: unknown;
  nonce?: unknown;
}

// Why an init message is unacceptable, or null if it is fine.
export function validateBrokerInit(m: BrokerInitMsg, canDropUser: boolean): string | null {
  if (typeof m.backend !== 'string' || !BACKENDS.has(m.backend)) return 'invalid init';
  if (typeof m.iface !== 'string' || !IFACE_RE.test(m.iface)) return 'invalid init';
  if (typeof m.sockPath !== 'string' || typeof m.nonce !== 'string') return 'invalid init';
  if (m.backend === 'tcpdump' && !canDropUser) {
    return 'no non-root SUDO_USER for tcpdump -Z — refusing to dissect as root';
  }
  return null;
}
