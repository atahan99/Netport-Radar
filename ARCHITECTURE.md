# netport-radar — Architecture

Visualization-only local network monitor. Your machine is an airport; every
connection is a flight on a great-circle arc. **Read-only by design** — the
capture path never injects, blocks, or modifies traffic.

![netport-radar data flow: a packet is captured by the root broker (tshark/tcpdump + lsof), streamed over IPC to the unprivileged server (flow tracker, geo lookup, WS/HTTP), then by WebSocket to the browser, where Zustand stores feed a two-channel renderer driving the 2D map, 3D globe, and HUD.](docs/architecture.svg)

## Contents

- [Data flow](#data-flow)
- [Ownership split](#ownership-split-the-core-contract)
- [Server](#server-server)
- [Frontend](#frontend-src)
- [Security model](#security-model)
- [Process attribution](#process-attribution)
- [IPv6 merge status](#ipv6-merge-status)
- [Livery](#livery)
- [Load testing & replay](#load-testing--replay)
- [Client diagnostics](#client-diagnostics)
- [Testing & conventions](#testing--conventions)

## Data flow

```
            (root)                                    (browser)
┌────────────────────────────┐          ┌─────────────────────────────────┐
│ tshark -T fields  (DPI)    │          │ useLiveFlights (src/lib/live.ts)│
│   └─ or tcpdump (ports)    │          │   • applies FlightEvents        │
│        server/capture.ts   │          │   • animates arcProgress (rAF)  │
│            │ RawPacket     │          │   • Zustand stores              │
│            ▼               │   WS     │        │                        │
│ FlowTracker                │  :8090   │        ▼                        │
│  server/flow-tracker.ts    │ ───────► │ MapView (MapLibre, DOM markers) │
│  • 5-tuple → Flow          │  JSON    │ GlobeView (three.js meshes)     │
│  • phase machine           │ batches  │ Boards / FlightCard / Metrics   │
│  • bytes, bps, DNS hold    │  /100ms  │                                 │
│            │ FlightEvent   │          └─────────────────────────────────┘
│            ▼               │
│ WsHub (server/ws.ts)       │   also: http :8080 serves dist/ (npm start)
│ logger.ts (NDJSON, memory) │
│ process-names.ts (lsof 2s) │
└────────────────────────────┘
```

## Ownership split (the core contract)

- **Server owns truth**: flow phases (`taxi → cruise → hold → descent →
  landed`), byte counters, process attribution, hostname/SNI.
- **Client owns animation**: `arcProgress` (position along the arc) is computed
  per-frame in the browser from phase + elapsed time. The server never sends
  positions.
- Updates ship as **patch events** (`updated` with changed fields), batched every
  100ms — never full-object rebroadcasts.

## Server (`server/`)

| File | Role |
|---|---|
| `config.ts` | Ports, bind host, token (all server tunables) |
| `capture.ts` | Backend detect (tshark → tcpdump → stub), line parsers, geoip, reverse-DNS cache |
| `flow-tracker.ts` | Packets → flows (5-tuple key), phase machine, metrics, classification |
| `process-names.ts` | `lsof -i -nP +c0 -FpcPn` poll (2s) → `proto:port` → owning app + PID |
| `ws.ts` | WsHub: batching, init/error replay, origin/token gate, control channel |
| `logger.ts` | In-memory NDJSON session log (capped 200k lines), export/reset |
| `index.ts` | Entry: preflight, home geolocation, capture supervisor, control handling, dist server |

**Phase machine:** new 5-tuple → `taxi` (DNS hold ≤2s) → `opened` event → data →
`cruise` → idle >5s → `hold` → data resumes → `cruise` → FIN/RST → `descent`
(2s) → `landed` → flow evicted after 30s (client keeps it ~60s for the fade).
No packets for 120s → force-closed.

## Frontend (`src/`)

**Stores (Zustand).** `flights` (list, selection, homes), `filters` (protocol
families, LAN/IPv6, DNS density, direction, search, country isolation, view mode
— persisted to sessionStorage), `backend`, `connection`, `toasts`, `diagnostics`
(WS/chunk failures for export).

**Render queue** (`lib/render-queue.ts`). Cap 150 flights + 20 DNS drones. When
full, bump priority: landed → hold → taxi; `cruise`/`descent` are never bumped.
Off-screen count shows in the metrics strip.

**Views.** `MapView` (imperative MapLibre markers + GeoJSON arc layers),
`GlobeView` (lazy-loaded chunk; custom three.js layer, shared geometry/material
caches in `lib/globe-meshes.ts`). Both read `lib/lifecycle.ts` poses (taxi spool,
hold circle, LAN orbit, landing flare).

**Livery precedence.** Resolved process brand color (`lib/livery.ts`) beats
hostname-hash color; late process resolution recolors markers + meshes in place.

**Theming** (`lib/themes.ts`, 7 themes). The 2D map recolors dark-matter paint by
layer type (`lib/map-recolor.ts`, applied live via a `[theme]` effect — no reload)
or swaps base style (Positron/Esri raster). The 3D globe is the vector analogue:
themed maps draw a flat ocean sphere + Natural Earth country polygons
(`public/geo/`); Satellite/Midnight use a real photo. Phase colors live in
`lib/phase.ts` (shared by legend/board/card).

**Demo mode.** `VITE_DEMO=1` swaps `useLiveFlights` for `lib/demo.ts` (simulated
flights; hidden keys R = reconnect overlay, B = burst 200).

**Accessibility.** The canvas is opaque to AT, so `SceneAnnouncer` adds an
off-screen description + a polite live region for the selected flight; boards are
`listbox`es with spoken labels; `[`/`]` step through flights (`lib/locate.ts`
centers the view); `prefers-reduced-motion` is honored.

## Security model

- Both servers bind **127.0.0.1 by default** — nothing is reachable from the
  network. The WS carries sensitive metadata (process names, SNI, IPs), so the
  loopback gate also enforces a **browser-origin allowlist** (localhost only),
  which blocks cross-site WebSocket access from arbitrary websites.
- `NETPORT_BIND=0.0.0.0` opts into LAN viewing; a **per-boot token** is then
  required on every WS connection (printed as a ready-to-open URL).
- Control messages are validated (`switch_iface` must name a real interface);
  client frames capped at 4KB.
- Outbound traffic: exactly **one** public-IP geolocation lookup per session
  (HTTPS-first chain; env-overridable) — nothing else leaves the machine.
- Capture requires root (BPF). The UI process is an ordinary browser tab.

**Privilege separation** (`priv-broker.ts`). Started via `sudo`, `index.ts` forks
a root **broker** that owns the only root-needing work (spawning `tshark`/`tcpdump`,
polling `lsof`) and streams `RawPacket`s + the process map to the parent over IPC.
The parent then `setgid`/`setgroups`/`setuid`s to the invoking user, so the WS
control channel, HTTP server, flow tracker, and parsers all run unprivileged; the
broker listens on no socket. After the drop, `assertNotRoot()` checks
`process.getuid()` and emits a WS `still_root` error if still uid 0. `switch_iface`
is a command to the broker; the parent can't re-elevate. Falls back to the
**inline** single-process path when not root / not via sudo / Windows / when
`NETPORT_NO_PRIVDROP=1`. NDJSON export is written by the (unprivileged) parent.

## Process attribution

`process-names.ts` polls `lsof -i -nP +c0 -FpcPn` every **2s** and keys on
`proto:localPort`. Short-lived flows that close before the next poll stay
`process: '—'`. UDP ephemeral port reuse can collide. Non-sudo runs only see the
current user's sockets. Late resolution emits `updated` and recolors markers.

## IPv6 merge status

Flow keys are literal-IP 5-tuples — the same logical connection over IPv4 and
IPv6 is **two flights** today. Merge by resolved hostname or IPv6 `/64` is
planned; not implemented yet.

## Livery

Brand colors in `src/lib/livery.ts`: `BRAND_COLORS` map + cross-platform
`ALIASES` regex table. Precedence: resolved process brand → hostname-hash HSL.
System processes are muted gray. See `tests/livery.test.ts`.

## Load testing & replay

`npm run replay -- session.ndjson --speed 10` (`server/scripts/replay.ts`) reads
exported NDJSON and replays `FlightEvent`s over WS without live capture. Dev FPS
overlay: `VITE_FPS=1` or press **F** in dev mode. Client render cap: 150 main +
20 DNS (`lib/render-queue.ts`).

## Client diagnostics

`src/store/diagnostics.ts` records WebSocket close codes/reasons and lazy-chunk
load failures (globe). Surfaced as amber hints in the metrics strip + toasts;
**Export diagnostics** (stethoscope icon) downloads a JSON snapshot.

## Testing & conventions

- **Verification gate:** `npm run check` = `tsc -b` + `tsc -p
  tsconfig.server.json` + eslint + vitest (148 tests; pure logic in `tests/*.ts`,
  component tests in `tests/*.test.tsx` on happy-dom). Enforced in CI
  (`.github/workflows/ci.yml`).
- **Browser smoke / visual checks** run via the Cursor browser or Playwright MCP
  against demo or live mode; they are not part of `check` or CI.
- TypeScript strict everywhere; `src/types.ts` is the single protocol source
  shared by server and client (`tsconfig.server.json` compiles both).
- Frontend imports via the `@/` alias; the server uses relative `../src/` imports.
