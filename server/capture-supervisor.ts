// server/capture-supervisor.ts
// Keeps one capture process alive. A capture that dies (sleep/wake, interface
// flap) is restarted once; a second death within 30s is declared dead. A
// permission error stops restarts (retrying won't fix it). Intentional kills
// (switch/stop) are told apart by process identity. Used by the inline path in
// index.ts and by the root broker.

import type { ChildProcess } from 'child_process';

export interface SupervisorEvents {
  permission(): void;
  error(msg: string): void;
  restarting(): void;
  dead(): void;
  noBackend(): void;
}

const PERMISSION_RE = /permission|denied|bpf|root|operation not permitted/i;
const RESTART_DELAY_MS = 2000;
const DEAD_WINDOW_MS = 30_000;

export function superviseCapture(
  spawnCapture: (onError: (msg: string) => void) => ChildProcess | null,
  ev: SupervisorEvents,
): { restart(): void; stop(): void } {
  let proc: ChildProcess | null = null;
  let stopped = false;
  let permissionDenied = false;
  let restartCount = 0;
  let lastRestart = 0;

  const onError = (msg: string) => {
    if (PERMISSION_RE.test(msg)) {
      permissionDenied = true;
      ev.permission();
    } else {
      ev.error(msg.slice(0, 200));
    }
  };

  const spawn = () => {
    const p = spawnCapture(onError);
    proc = p;
    if (!p) {
      ev.noBackend();
      return;
    }
    p.on('exit', () => {
      if (p !== proc || stopped || permissionDenied) return;
      const now = Date.now();
      const recent = now - lastRestart < DEAD_WINDOW_MS;
      if (recent && restartCount >= 1) {
        ev.dead();
        return;
      }
      restartCount = recent ? restartCount + 1 : 1;
      lastRestart = now;
      ev.restarting();
      setTimeout(() => {
        if (p === proc && !stopped && !permissionDenied) spawn();
      }, RESTART_DELAY_MS);
    });
  };

  spawn();
  return {
    restart() {
      permissionDenied = false;
      restartCount = 0;
      const old = proc;
      spawn(); // reassign first so the old process's exit handler no-ops
      old?.kill();
    },
    stop() {
      stopped = true;
      proc?.kill();
    },
  };
}
