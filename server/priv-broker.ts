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
import { superviseCapture } from './capture-supervisor';
import { startProcessPolling, noteLookupMiss, type ProcEntry } from './process-names';

export type BrokerOut =
  | { t: 'proc'; entries: [string, ProcEntry][] }
  | { t: 'permission' }
  | { t: 'err'; msg: string }
  | { t: 'dead' }
  | { t: 'restarting' }
  | { t: 'no_backend' };

export type BrokerIn =
  | { t: 'init'; backend: CaptureBackend; iface: string; sockPath: string; nonce: string }
  | { t: 'switch'; iface: string }
  | { t: 'boost' } // parent saw an unattributed flow — poll lsof faster
  | { t: 'stop' };

const send = (m: BrokerOut) => process.send?.(m);

let backend: CaptureBackend = 'tshark';
let iface = 'en0';
let sockPath = '';
let nonce = '';
let initialized = false;
let sup: ReturnType<typeof superviseCapture> | null = null;

// The parent drops to the user right after forking us, so after 'init' its
// messages are untrusted input to a root process: init is accepted once (sent
// before the drop), the tcpdump -Z user comes from our own sudo env, and
// interface names are checked on every switch.
const IFACE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const BACKENDS: ReadonlySet<string> = new Set(['tshark', 'tcpdump', 'pcap']);
const dropUser = process.env.SUDO_USER ?? '';
const dropUserOk = /^[a-z_][a-z0-9_.-]*$/i.test(dropUser) && dropUser !== 'root';

// Raw capture whose output streams to the parent over the nonce-gated socket.
function spawnRaw(onError: (msg: string) => void): ChildProcess | null {
  const p = startRawCapture(backend, iface, dropUser, onError);
  if (!p) return null;
  const conn = net.createConnection(sockPath, () => {
    conn.write(`${nonce}\n`);
    p.stdout!.pipe(conn);
  });
  conn.on('error', (e) => {
    onError(`capture stream: ${e.message}`);
    p.kill();
  });
  return p;
}

function startSupervisor(): void {
  sup = superviseCapture(spawnRaw, {
    permission: () => send({ t: 'permission' }),
    error: (msg) => send({ t: 'err', msg }),
    restarting: () => send({ t: 'restarting' }),
    dead: () => send({ t: 'dead' }),
    noBackend: () => send({ t: 'no_backend' }),
  });
}

function stop(): void {
  sup?.stop();
  process.exit(0);
}

process.on('message', (m: BrokerIn) => {
  if (m.t === 'init') {
    if (initialized) return;
    if (!BACKENDS.has(m.backend) || !IFACE_RE.test(m.iface) || typeof m.sockPath !== 'string' || typeof m.nonce !== 'string') {
      send({ t: 'err', msg: 'broker: invalid init' });
      return;
    }
    if (m.backend === 'tcpdump' && !dropUserOk) {
      send({ t: 'err', msg: 'broker: no non-root SUDO_USER for tcpdump -Z — refusing to dissect as root' });
      return;
    }
    initialized = true;
    backend = m.backend;
    iface = m.iface;
    sockPath = m.sockPath;
    nonce = m.nonce;
    startSupervisor();
    startProcessPolling((entries) => send({ t: 'proc', entries }));
  } else if (m.t === 'switch') {
    if (!initialized || !IFACE_RE.test(m.iface)) return;
    iface = m.iface;
    sup?.restart();
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
