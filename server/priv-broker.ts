// server/priv-broker.ts
// Privileged capture broker. index.ts forks this child WHILE STILL ROOT, then
// drops itself to the invoking user. The broker keeps the two root-only jobs:
// opening the capture device and polling lsof. It never parses packets itself
// (see startRawCapture). Each capture instance streams its output to the parent
// over a private Unix socket (0700 dir), prefixed with a per-boot nonce so the
// parent only decodes streams that came from this broker.
//
// Parent → broker: init / switch / boost / stop (IPC)
// Broker → parent: proc / permission / err / dead / restarting / no_backend (IPC),
//                  plus one socket connection per capture instance (pcap data)

import net from 'net';
import type { ChildProcess } from 'child_process';
import { startRawCapture, type CaptureBackend } from './capture';
import { startProcessPolling, noteLookupMiss, type ProcEntry } from './process-names';

export type BrokerOut =
  | { t: 'proc'; entries: [string, ProcEntry][] }
  | { t: 'permission' }
  | { t: 'err'; msg: string }
  | { t: 'dead' }
  | { t: 'restarting' }
  | { t: 'no_backend' };

export type BrokerIn =
  | { t: 'init'; backend: CaptureBackend; iface: string; sockPath: string; nonce: string; dropUser: string }
  | { t: 'switch'; iface: string }
  | { t: 'boost' } // parent saw an unattributed flow — poll lsof faster
  | { t: 'stop' };

const send = (m: BrokerOut) => process.send?.(m);

let backend: CaptureBackend = 'tshark';
let iface = 'en0';
let sockPath = '';
let nonce = '';
let dropUser = '';
let proc: ChildProcess | null = null;
let shuttingDown = false;
let permissionDenied = false;
let restartCount = 0;
let lastRestart = 0;

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
  const p = startRawCapture(backend, iface, dropUser, onErr);
  proc = p;
  if (!p) {
    send({ t: 'no_backend' });
    return;
  }
  const conn = net.createConnection(sockPath, () => {
    conn.write(`${nonce}\n`);
    p.stdout!.pipe(conn);
  });
  conn.on('error', (e) => {
    onErr(`capture stream: ${e.message}`);
    p.kill();
  });
  p.on('exit', () => {
    if (p !== proc || shuttingDown || permissionDenied) return;
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
  proc?.kill();
  process.exit(0);
}

process.on('message', (m: BrokerIn) => {
  if (m.t === 'init') {
    backend = m.backend;
    iface = m.iface;
    sockPath = m.sockPath;
    nonce = m.nonce;
    dropUser = m.dropUser;
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
