// server/process-names.ts
// Maps a local socket (proto:port) to the owning process by polling lsof.
// Uses -F field mode so command names with spaces ("Google Chrome Helper")
// parse cleanly. Runs as root (sudo) → sees every process's sockets.

import { execSync } from 'child_process';
import { normalizeProcess } from '../src/lib/livery';

interface ProcEntry {
  command: string;
  pid: number;
}

let table = new Map<string, ProcEntry>();
let timer: ReturnType<typeof setInterval> | undefined;

function poll(): void {
  let out = '';
  try {
    out = execSync('lsof -i -nP +c0 -FpcPn', {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    // lsof often exits non-zero (unreadable handles) but still prints stdout.
    const so = (e as { stdout?: string | Buffer }).stdout;
    out = typeof so === 'string' ? so : so ? so.toString() : '';
    if (!out) return;
  }

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
  if (next.size > 0) table = next;
}

export function startProcessPolling(): void {
  poll();
  timer = setInterval(poll, 2000);
}

export function stopProcessPolling(): void {
  if (timer) clearInterval(timer);
}

export function lookupProcess(
  localPort: number,
  proto: string,
): { process: string; processRaw: string; pid: number } | null {
  const e = table.get(`${proto}:${localPort}`);
  if (!e) return null;
  return { process: normalizeProcess(e.command), processRaw: e.command, pid: e.pid };
}
