# netport-radar — Architecture

Visualization-only local network monitor. Your machine is an airport; every
connection is a flight on a great-circle arc. **Read-only by design** — the
capture path never injects, blocks, or modifies traffic.

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
- Updates ship as **patch events** (`updated` with changed fields), batched
  every 100ms — never full-object rebroadcasts.

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

Phase machine: new 5-tuple → `taxi` (DNS hold ≤2s) → `opened` event → data →
`cruise` → idle >5s → `hold` → data resumes → `cruise` → FIN/RST → `descent`
(2s) → `landed` → flow evicted after 30s (client keeps it ~60s for the fade).
No packets for 120s → force-closed.

## Frontend (`src/`)

- **Stores (Zustand)**: `flights` (list, selection, homes), `filters`
  (protocol families, LAN/IPv6, DNS density, direction, search, country
  isolation, view mode — persisted to sessionStorage), `backend`, `connection`,
  `toasts`.
- **Render queue** (`lib/render-queue.ts`): cap 150 flights + 20 DNS drones.
  When full, bump priority: landed → hold → taxi; `cruise`/`descent` never
  bumped. Off-screen count shows in the metrics strip.
- **Views**: `MapView` (imperative MapLibre markers + GeoJSON arc layers),
  `GlobeView` (lazy-loaded chunk; custom three.js layer, shared
  geometry/material caches in `lib/globe-meshes.ts`). Both read
  `lib/lifecycle.ts` poses (taxi spool, hold circle, LAN orbit, landing flare).
- **Livery precedence**: resolved process brand color (`lib/livery.ts`) beats
  hostname-hash color; late process resolution recolors markers + meshes in place.
- **Demo mode**: `VITE_DEMO=1` swaps `useLiveFlights` for `lib/demo.ts`
  (simulated flights; hidden keys R = reconnect overlay, B = burst 200).

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

## Conventions

- TypeScript strict everywhere; `src/types.ts` is the single protocol source
  shared by server and client (`server/tsconfig.server.json` compiles both).
- Frontend imports via `@/` alias; server uses relative `../src/` imports.
- Verification gate: `tsc -b` + `tsc -p tsconfig.server.json` + build
  (becoming `npm run check` with lint + tests in later phases).
