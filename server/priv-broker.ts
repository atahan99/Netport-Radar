// server/priv-broker.ts
// Privileged capture broker. index.ts forks this child WHILE STILL ROOT, then
// immediately drops itself to the invoking user. The broker keeps the two
// root-only capabilities — spawning tshark/tcpdump and polling lsof — and streams
// results to the unprivileged parent over the IPC channel. It listens to no
// network socket; its only inputs are tshark's (already-decoded) output and the
// parent's commands, so the network-facing surface (WS/HTTP/flow tracker) stays
// unprivileged in the parent.
//
// Parent → broker: { t:'init'|'switch', backend?, iface } · { t:'stop' }
// Broker → parent: pkts / proc / permission / err / dead / restarting / no_backend

import * as os from 'os';
import type { ChildProcess } from 'child_process';
import { startCapture, type CaptureBackend, type RawPacket } from './capture';
import { startProcessPolling, noteLookupMiss, type ProcEntry } from './process-names';

export type BrokerOut =
  | { t: 'pkts'; pkts: RawPacket[] }
  | { t: 'proc'; entries: [string, ProcEntry][] }
  | { t: 'permission' }
  | { t: 'err'; msg: string }
  | { t: 'dead' }
  | { t: 'restarting' }
  | { t: 'no_backend' };

export type BrokerIn =
  | { t: 'init'; backend: CaptureBackend; iface: string }
  | { t: 'switch'; iface: string }
  | { t: 'boost' } // parent saw an unattributed flow — poll lsof faster
  | { t: 'stop' };

const send = (m: BrokerOut) => process.send?.(m);

function localIps(): Set<string> {
  const set = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) set.add(a.address);
  }
  return set;
}

let backend: CaptureBackend = 'tshark';
let iface = 'en0';
let proc: ChildProcess | null = null;
let shuttingDown = false;
let permissionDenied = false;
let restartCount = 0;
let lastRestart = 0;

// Batch packets so IPC isn't one round-trip per packet.
let batch: RawPacket[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (batch.length) {
    send({ t: 'pkts', pkts: batch });
    batch = [];
  }
}
function queue(p: RawPacket): void {
  batch.push(p);
  if (batch.length >= 200) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 40);
}

function onErr(msg: string): void {
  if (/permission|denied|bpf|root|operation not permitted/i.test(msg)) {
    permissionDenied = true; // a restart won't fix this
    send({ t: 'permission' });
  } else {
    send({ t: 'err', msg: msg.slice(0, 200) });
  }
}

// Supervisor mirrors index.ts's old behavior: a capture that dies (sleep/wake,
// interface flap) restarts once; a second death within 30s is declared dead. An
// intentional kill (switch/stop) is distinguished by proc identity.
function spawnCapture(): void {
  const p = startCapture(backend, iface, localIps(), queue, onErr);
  proc = p;
  if (!p) {
    send({ t: 'no_backend' });
    return;
  }
  p.on('exit', () => {
    if (p !== proc || shuttingDown || permissionDenied) return;
    flush();
    const now = Date.now();
    const recent = now - lastRestart < 30_000;
    if (recent && restartCount >= 1) {
      send({ t: 'dead' });
      return;
    }
    restartCount = recent ? restartCount + 1 : 1;
    lastRestart = now;
    send({ t: 'restarting' });
    setTimeout(() => {
      if (p === proc && !shuttingDown && !permissionDenied) spawnCapture();
    }, 2000);
  });
}

function stop(): void {
  shuttingDown = true;
  flush();
  proc?.kill();
  process.exit(0);
}

process.on('message', (m: BrokerIn) => {
  if (m.t === 'init') {
    backend = m.backend;
    iface = m.iface;
    spawnCapture();
    startProcessPolling((entries) => send({ t: 'proc', entries }));
  } else if (m.t === 'switch') {
    iface = m.iface;
    permissionDenied = false;
    restartCount = 0;
    proc?.kill(); // its exit handler no-ops once spawnCapture reassigns proc
    spawnCapture();
  } else if (m.t === 'boost') {
    noteLookupMiss();
  } else if (m.t === 'stop') {
    stop();
  }
});

// Never linger as root if the parent goes away or we're signalled.
process.on('disconnect', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
