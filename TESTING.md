# Testing notes (Track A — capture & attribution)

## Live wiring baseline

```bash
lsof -iTCP:8080 -sTCP:LISTEN -P -n
lsof -iTCP:8090 -sTCP:LISTEN -P -n
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/   # when SERVE_DIST=1
node --input-type=module -e "
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8090', { headers: { Origin: 'http://127.0.0.1:8080' } });
let n = { init: 0, opened: 0, updated: 0, phase: 0 };
ws.on('message', (d) => { const m = JSON.parse(d); n[m.type] = (n[m.type] ?? 0) + 1; });
setTimeout(() => { console.log(JSON.stringify(n)); ws.close(); process.exit(0); }, 5000);
"
```

## Privilege paths

| Mode | Command | Expected tree |
|------|---------|---------------|
| Inline (user + BPF) | `npm run server` | Single process as your user; `lsof` in-process |
| Brokered drop | `sudo npm start` | Parent dropped to `SUDO_UID`; child `priv-broker.ts` as root |
| No drop (intentional) | `sudo NETPORT_NO_PRIVDROP=1 npm start` | Single root process |

After brokered start, logs must show `[security] dropped to uid=…` and `[security] effective uid=…` **≠ 0**. If still root, a `privilege_drop_failed` WS banner is emitted.

## Process attribution

- `lookupProcess` keys on `TCP|UDP:localPort` from an adaptive `lsof` poll:
  2s idle, boosted to 500ms (plus an immediate debounced poll) while a young
  flow is unattributed (`noteLookupMiss`, forwarded as a `boost` IPC message in
  brokered runs).
- `PROCESS_RETAIN_MS` (3s) keeps mappings after socket close so sub-poll flows (e.g. burst `curl`) still resolve when possible.
- UDP ephemeral reuse and non-sudo `lsof` (only your user's sockets) remain known limits.

## Self-noise

Boot geo lookups resolve `ipapi.co`, `ip-api.com`, `api.ipify.org` into `selfProbeIps` (never flights). `flow-tracker` drops loopback, multicast, and `*.in-addr.arpa` / `*.ip6.arpa` PTR noise.
