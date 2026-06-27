// server/process-names.ts
// Maps a local socket (proto:port) to the owning process by polling lsof.
// Uses -F field mode so command names with spaces ("Google Chrome Helper")
// parse cleanly. Runs as root (sudo) → sees every process's sockets.
// Rows linger PROCESS_RETAIN_MS after the socket closes so sub-2s flows still attribute.


import { execSync } from 'child_process';
import { normalizeProcess } from '../src/lib/livery';
import { PROCESS_POLL_MS, PROCESS_RETAIN_MS } from './config';

export interface ProcEntry {
  command: string;
  pid: number;
}

let table = new Map<string, ProcEntry>();
// Short-lived TCP flows can close between 2s lsof polls; retain the last mapping briefly.
const staleRetain = new Map<string, { entry: ProcEntry; expiresAt: number }>();
let timer: ReturnType<typeof setInterval> | undefined;
let onPollCb: ((entries: [string, ProcEntry][]) => void) | undefined;

function runLsof(): string {
  try {
    return execSync('lsof -i -nP +c0 -FpcPn', {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    // lsof often exits non-zero (unreadable handles) but still prints stdout.
    const so = (e as { stdout?: string | Buffer }).stdout;
    return typeof so === 'string' ? so : so ? so.toString() : '';
  }
}

function poll(): void {
  const out = runLsof();
  if (!out) return;

  const next = new Map<string, ProcEntry>();
  let pid = 0;
  let command = '';
  let proto = '';
  for (const line of out.split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === 'p') {
      pid = Number(val) || 0;
      command = '';
      proto = '';
    } else if (tag === 'c') {
      command = val;
    } else if (tag === 'P') {
      proto = val; // TCP / UDP
    } else if (tag === 'n') {
      const local = val.split('->')[0];
      const m = local.match(/:(\d+)$/);
      if (m && (proto === 'TCP' || proto === 'UDP')) {
        next.set(`${proto}:${m[1]}`, { command, pid });
      }
    }
  }
  const now = Date.now();
  for (const [key, entry] of table) {
    if (!next.has(key)) staleRetain.set(key, { entry, expiresAt: now + PROCESS_RETAIN_MS });
  }
  for (const [key, { entry, expiresAt }] of staleRetain) {
    if (expiresAt <= now) staleRetain.delete(key);
    else if (!next.has(key)) next.set(key, entry);
  }
  for (const key of next.keys()) staleRetain.delete(key);

  if (next.size > 0) {
    table = next;
    onPollCb?.([...next]); // privileged broker forwards this to the parent
  }
}

// `onPoll` lets the privileged broker stream each lsof result to the unprivileged
// parent (which can't run a root lsof itself after dropping privileges).
export function startProcessPolling(onPoll?: (entries: [string, ProcEntry][]) => void): void {
  onPollCb = onPoll;
  poll();
  timer = setInterval(poll, PROCESS_POLL_MS);
}

export function stopProcessPolling(): void {
  if (timer) clearInterval(timer);
}

// Parent side: inject the table received from the broker so lookupProcess works.
export function setProcessTable(entries: [string, ProcEntry][]): void {
  table = new Map(entries);
}

export function lookupProcess(
  localPort: number,
  proto: string,
): { process: string; processRaw: string; pid: number } | null {
  const e = table.get(`${proto}:${localPort}`);
  if (!e) return null;
  return { process: normalizeProcess(e.command), processRaw: e.command, pid: e.pid };
}
