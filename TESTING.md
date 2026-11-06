# Testing

## Automated

```bash
npm run check                 # tsc (app + server), eslint, vitest
npx vitest run --coverage     # server/ and src/lib/ coverage
npm audit --omit=dev          # runtime dependencies (CI fails on high/critical)
```

The unit tests cover the capture parsers (fixture strings, so CI needs no capture
tools), the flow tracker's phase machine and snapshot, the capture supervisor,
the WebSocket hub's origin/token gate and inbound validation, the static
server's path confinement, the pcap socket's nonce check, the `lsof` parser and
retention, and the live client's reconnect and init handling against a fake
WebSocket. The React views, process wiring in `server/index.ts` and three.js mesh
construction are checked live instead (below).

## Live checks

### Servers and the WebSocket feed

```bash
lsof -iTCP:8080 -sTCP:LISTEN -P -n
lsof -iTCP:8090 -sTCP:LISTEN -P -n
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
node --input-type=module -e "
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8090', { headers: { Origin: 'http://127.0.0.1:8080' } });
let n = {};
ws.on('message', (d) => { const m = JSON.parse(d); n[m.type] = (n[m.type] ?? 0) + 1; });
setTimeout(() => { console.log(JSON.stringify(n)); ws.close(); process.exit(0); }, 5000);
"
```

### Hardening

```bash
# A malformed frame must be dropped; the server keeps running.
node -e 'const W=require("ws");const w=new W("ws://127.0.0.1:8090");w.on("open",()=>{w.send("null");setTimeout(()=>process.exit(0),500)})'
lsof -ti tcp:8090 -sTCP:LISTEN

# Paths outside dist/ must return 404.
curl -s --path-as-is -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/../../etc/passwd
```

### Privilege paths

| Mode | Command | Expected process tree |
| --- | --- | --- |
| Inline | `npm run server` (with ChmodBPF/`setcap`) | One process as your user; `tshark` and `lsof` run as you |
| Brokered | `npm run build && sudo npm run serve` | Server and `tshark -i -` as you; broker, `dumpcap` and `lsof` as root |
| Brokered, tcpdump | `sudo NETPORT_BACKEND=tcpdump npm run serve` | `tcpdump -i <if> -Z <you>` running as you after the drop |
| No drop | `sudo NETPORT_NO_PRIVDROP=1 npm run serve` | One root process (explicit opt-out) |

```bash
ps -axo user,pid,ppid,command | grep -E "server/index.ts|priv-broker|dumpcap|tshark|tcpdump" | grep -v grep
```

A brokered start logs `[security] dropped to uid=…` and `[security] effective
uid=…` with a non-zero uid. If the drop fails, the server exits. On SIGINT the
broker and capture processes must exit and the socket directory must be removed.

### Process attribution

`lookupProcess` keys on `TCP|UDP:localPort`. The `lsof` poll runs every 2 s when
idle and every 1 s, plus an immediate debounced poll, while a young flow is
unattributed (`noteLookupMiss`, sent as a `boost` message to the broker in
brokered runs). Rows for closed sockets are kept for `PROCESS_RETAIN_MS` (3 s) so
short flows such as a burst of `curl` requests still resolve, then they expire.
UDP ephemeral port reuse and unprivileged `lsof` (your own sockets only) are
known limits.

### Self-noise

The geolocation hosts (`ipapi.co`, `ip-api.com`, `api.ipify.org`) are resolved at
boot into `selfProbeIps` and never become flights. The flow tracker also drops
loopback, multicast, and `*.in-addr.arpa` / `*.ip6.arpa` PTR lookups.

### Browser

Run `npm run dev:demo`, or `npm run dev` with a live server, and check the views
in a browser at desktop and phone widths (375 px). A browser tab in the
background throttles `requestAnimationFrame`, so check animation and throughput
numbers in a foreground tab.
