// server/process-names.ts
// Maps a local socket (proto:port) to the owning process by polling lsof.
// Uses -F field mode so command names with spaces ("Google Chrome Helper")
// parse cleanly. Runs as root (sudo) → sees every process's sockets.
// Rows linger PROCESS_RETAIN_MS after the socket closes so sub-2s flows still attribute.


import { execFile } from 'child_process';
import { normalizeProcess } from '../src/lib/livery';
import {
  PROCESS_POLL_MS,
  PROCESS_POLL_BOOST_MS,
  PROCESS_BOOST_WINDOW_MS,
  PROCESS_POLL_MIN_MS,
  PROCESS_RETAIN_MS,
} from './config';

export interface ProcEntry {
  command: string;
  pid: number;
}

let table = new Map<string, ProcEntry>();
// Short-lived TCP flows can close between 2s lsof polls; retain the last mapping briefly.
const staleRetain = new Map<string, { entry: ProcEntry; expiresAt: number }>();
let timer: ReturnType<typeof setTimeout> | undefined;
let onPollCb: ((entries: [string, ProcEntry][]) => void) | undefined;
let polling = false;
let lastPollAt = 0;
// Adaptive cadence: lookup misses (new unattributed flows) boost the poll rate
// for a short window so fresh connections get their process/livery fast.
let boostUntil = 0;

function runLsof(): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-i', '-nP', '+c0', '-FpcPn'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        // lsof often exits non-zero (unreadable handles) but still prints stdout.
        const so = (error as { stdout?: string | Buffer }).stdout ?? stdout;
        resolve(typeof so === 'string' ? so : so ? so.toString() : '');
      },
    );
  });
}

let pollInFlight = false;

function poll(): void {
  if (pollInFlight) return;
  pollInFlight = true;
  lastPollAt = Date.now();
  void runLsof().then((out) => {
    pollInFlight = false;
    if (!out) return;
    applyLsofOutput(out);
  });
}

export function applyLsofOutput(out: string): void {
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
  // Rows lsof reports now. Retained rows get merged into `next` below, so the
  // retention bookkeeping must key off this set, not `next` — otherwise every
  // poll re-arms the clock and closed sockets stay attributed forever.
  const live = new Set(next.keys());
  for (const [key, entry] of table) {
    if (!live.has(key) && !staleRetain.has(key)) {
      staleRetain.set(key, { entry, expiresAt: now + PROCESS_RETAIN_MS });
    }
  }
  for (const key of live) staleRetain.delete(key);
  for (const [key, { entry, expiresAt }] of staleRetain) {
    if (expiresAt <= now) staleRetain.delete(key);
    else next.set(key, entry);
  }

  if (next.size > 0) {
    table = next;
    onPollCb?.([...next]); // privileged broker forwards this to the parent
  }
}

function scheduleNext(): void {
  if (!polling) return;
  const interval = Date.now() < boostUntil ? PROCESS_POLL_BOOST_MS : PROCESS_POLL_MS;
  timer = setTimeout(() => {
    poll();
    scheduleNext();
  }, interval);
}

// `onPoll` lets the privileged broker stream each lsof result to the unprivileged
// parent (which can't run a root lsof itself after dropping privileges).
export function startProcessPolling(onPoll?: (entries: [string, ProcEntry][]) => void): void {
  onPollCb = onPoll;
  polling = true;
  poll();
  scheduleNext();
}

export function stopProcessPolling(): void {
  polling = false;
  if (timer) clearTimeout(timer);
}

// A lookup missed (new flow with no attribution yet): boost the cadence and —
// debounced — poll right away so the flow colors within ~PROCESS_POLL_MIN_MS
// instead of waiting out the idle interval. Only effective where polling runs
// (inline mode or the root broker); the unprivileged parent just no-ops.
export function noteLookupMiss(): void {
  boostUntil = Date.now() + PROCESS_BOOST_WINDOW_MS;
  if (!polling) return;
  if (Date.now() - lastPollAt < PROCESS_POLL_MIN_MS) return;
  poll();
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
