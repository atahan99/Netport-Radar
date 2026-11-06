# netport-radar

A read-only network monitor that draws every connection on your machine as a
flight. Your computer is the airport; each TCP/UDP/ICMP flow takes off toward the
country of the remote IP on a great-circle arc, on a 2D map or a 3D globe. Packet
capture and deep packet inspection run locally, and the capture path never
blocks, injects or modifies traffic.

It is also a small exercise in running a privileged network tool safely: capture
needs root, while the part that faces the network (a WebSocket server, an HTTP
server and the protocol dissectors) does not.

| 2D map | 3D globe |
| --- | --- |
| ![2D map with live flights](docs/screenshot-map-2d.png) | ![3D globe view](docs/screenshot-globe-3d.png) |

| Flight card | Filters |
| --- | --- |
| ![Flight card detail](docs/screenshot-flight-card.png) | ![Filter drawer](docs/screenshot-filters.png) |

## Security and infrastructure design

### Threat model

The tool sees every host, IP and process you talk to, and it parses traffic that
other people control. The design assumes three things can be hostile:

1. Packets on the wire. Protocol dissectors have a long CVE history, so they must
   not run as root.
2. Other local processes and web pages. Any process on the machine can open the
   loopback WebSocket, and a website open in your browser can try to as well
   (browsers don't apply CORS to WebSockets).
3. Devices on your LAN, when you opt into remote viewing.

### Privilege separation

`sudo npm run serve` starts one root process that immediately forks a broker
and drops itself to the invoking user (`SUDO_UID`/`SUDO_GID`):

| Process | Runs as | Does |
| --- | --- | --- |
| broker (`priv-broker.ts`) | root | opens the capture device, polls `lsof` |
| `dumpcap` (tshark backend) | root | writes raw pcap, parses nothing |
| `tcpdump -Z <user>` (tcpdump backend) | root, then your user | opens BPF as root, drops before parsing |
| server (`index.ts`) | your user | WebSocket + HTTP servers, flow tracker |
| `tshark -i -` | your user | all protocol dissection |

![Data flow: the root broker captures raw packets and lsof data, streams pcap over a nonce-gated Unix socket to the unprivileged server, which dissects, tracks flows and serves the browser over WebSocket.](docs/architecture.svg)

- The pcap stream travels over a Unix socket in a fresh `0700` directory owned by
  your user. Every connection must open with a per-boot nonce before a byte
  reaches the decoder, so a stray local process can't feed in fake traffic.
- The broker treats the parent's IPC as untrusted once the parent has dropped:
  `init` is accepted once, the `tcpdump -Z` user comes from the broker's own
  `SUDO_USER` (never root), and interface names are validated on every switch.
- The drop fails closed. If `setuid`/`setgid` fails, or the process is still uid 0
  afterwards, the server exits instead of carrying on as root.
  `NETPORT_NO_PRIVDROP=1` is the explicit opt-out.
- Run without sudo (ChmodBPF on macOS, `setcap` on Linux, admin on Windows) and
  everything runs in one unprivileged process.

### Network exposure

- Both servers bind `127.0.0.1` by default.
- In loopback mode the WebSocket accepts only localhost browser origins, which
  stops a hostile website from reading your traffic feed. Non-browser clients
  without an `Origin` header are allowed, since they are already local processes.
- `NETPORT_BIND=0.0.0.0` exposes the dashboard to your LAN and requires a
  per-boot token on every WebSocket connection, compared in constant time.
- Inbound WebSocket frames are capped at 4 KB and must parse as one of two known
  message shapes; anything else is dropped. The static file server resolves every
  path inside `dist/` and answers 404 otherwise.

### What leaves the machine

- One public-IP geolocation lookup per session to place your home airport:
  `ipapi.co` (HTTPS), falling back to `ip-api.com` (plain HTTP) and then
  `api.ipify.org` with the local GeoIP database. Set `NETPORT_HOME_LAT` and
  `NETPORT_HOME_LNG` to skip it.
- Reverse DNS (PTR) lookups for remote IPs that have no SNI or HTTP host, sent to
  your normal resolver.
- Map tiles: the browser fetches basemaps from CARTO (and Esri imagery for the
  Satellite theme).

Session logs stay in memory. They are written to disk only when you set
`NETPORT_SESSION_LOG=<dir>`, with `0700`/`0600` permissions.

### CI

GitHub Actions runs `npm run check` on every push and pull request (type checks
for the app and the server, ESLint, and the vitest suite), then
`npm audit --omit=dev --audit-level=high`, which fails the build on any high or
critical advisory in a runtime dependency.

## Quick start

```bash
npm install
npm run build
sudo npm run serve      # opens http://localhost:8080
```

Build as your normal user and only `serve` under sudo, so `dist/` never ends up
owned by root. To skip sudo entirely, set up capture permissions as described in
[Platform setup](#platform-setup) and run `npm start`, which builds and serves in
one step.

To try the UI without capturing anything:

```bash
npm run dev:demo        # simulated flights on http://localhost:5173
```

## Platform setup

The backend prefers tshark (from Wireshark), which gives full deep packet
inspection: TLS SNI, HTTP hosts and DNS names. Without it, tcpdump gives
port-based protocol guessing. The `DPI:` indicator in the top bar shows which one
is running.

### macOS

```bash
brew install --cask wireshark      # provides tshark and dumpcap
npm run build && sudo npm run serve
```

To run without sudo, install Wireshark's ChmodBPF helper (offered on first launch
of Wireshark). It gives your user access to `/dev/bpf*`, and `npm start` then
works unprivileged.

### Linux

```bash
sudo apt install tshark            # or: dnf install wireshark-cli
npm run build && sudo npm run serve
```

To run without sudo, grant the capture capabilities to the binaries that open the
device:

```bash
sudo setcap cap_net_raw,cap_net_admin=eip "$(command -v dumpcap)"
sudo setcap cap_net_raw,cap_net_admin=eip "$(command -v tcpdump)"
```

### Windows

Install Wireshark with Npcap ("WinPcap API compatible" checked), then run
`npm start` from an Administrator terminal. Windows always uses the
single-process path.

## Run modes

| Mode | Command | What it does |
| --- | --- | --- |
| Live | `npm run build && sudo npm run serve` | Privilege-separated capture, UI on `:8080` |
| Live, unprivileged | `npm start` | Build and serve in one process (needs capture permissions) |
| Dev | `npm run dev` + `npm run server` | Vite UI on `:5173`, capture and WebSocket on `:8090` |
| Demo | `npm run dev:demo` | Simulated flights, no backend |
| Replay | `npm run replay -- session.ndjson` | Feed a recorded session over WebSocket |

Replay is useful for load and GPU profiling without live traffic:

```bash
npm run replay -- path/to/session.ndjson --speed 10   # stop any live server on :8090 first
npm run dev
```

Options are `--speed N` (default 1), `--loop` and `--port 8090`. It accepts server
NDJSON exports and client-side flight snapshots. Press `F` in dev mode (or set
`VITE_FPS=1`) for an FPS overlay.

## Configuration

All settings are environment variables. Pass them through sudo, for example
`sudo NETPORT_BIND=0.0.0.0 npm run serve`.

| Variable | Effect |
| --- | --- |
| `NETPORT_BIND` | Bind address for both servers. Anything other than loopback turns on token auth and prints a tokenized URL. |
| `NETPORT_HOME_LAT`, `NETPORT_HOME_LNG`, `NETPORT_HOME_LABEL` | Place the home airport manually and skip the geolocation lookup. |
| `NETPORT_MMDB_CITY`, `NETPORT_MMDB_ASN` | Paths to MaxMind GeoLite2 City and ASN databases for city-level destinations and real ASN/org data. Without them the bundled country-level database is used. |
| `NETPORT_IFACE` | Capture interface (default: the interface of the default route). |
| `NETPORT_BACKEND` | Force `tshark` or `tcpdump`. |
| `NETPORT_SESSION_LOG` | Directory to write the NDJSON session log to on shutdown. Off by default. |
| `NETPORT_NO_PRIVDROP` | Keep one root process instead of the broker split. |

On a VPN the capture interface is usually a tunnel (`utun*`, `wg*`, `tun*`), and
the home airport is labeled as a VPN exit. Additional public source IPs that
geolocate more than 100 km away are shown as extra VPN airports. City-level
destinations show a flag; country-level guesses show `~CC`; unknown destinations
sit on a `??` shelf in the mid-Atlantic.

## Using it

- Click a plane (on either view) or a departures/arrivals row to open its flight
  card. Click empty map or sky to clear it.
- `[` and `]` step through the flights on screen, and `Esc` clears the selection.
- The toolbar opens filters (protocols, traffic type, direction, search, trail
  colors), switches between 2D and 3D, picks one of seven themes, and opens the
  legend.
- In demo mode, `R` shows the reconnect overlay and `B` adds a burst of 200
  flights.

The map and globe are canvases, so the same data is reachable without them: an
off-screen description and a polite live region announce the selected flight,
the boards are listboxes with spoken labels and arrow-key navigation, and
`prefers-reduced-motion` is honored.

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| "No capture backend found" | Neither tshark nor tcpdump is installed | Install Wireshark (see [Platform setup](#platform-setup)) |
| "Port 8090 is already in use" | Another instance holds the WebSocket port | `lsof -ti tcp:8090 \| xargs kill`, then restart |
| Amber "No capture permission" banner | The server runs but can't open the device | Use sudo, or set up ChmodBPF / `setcap` |
| Server exits with "privilege drop failed" | sudo didn't provide a non-root `SUDO_UID`/`SUDO_GID` | Run through `sudo` from your normal account, or set `NETPORT_NO_PRIVDROP=1` deliberately |
| "dist/ is owned by root" warning | An earlier build ran under sudo | `sudo chown -R "$USER" dist` |
| "Reconnecting…" overlay | The WebSocket dropped | The client retries every 3 s; check that the server is running |
| Amber hint in the top bar | A WebSocket disconnect or a failed lazy chunk load | Export diagnostics (stethoscope icon) for details |

## Known limitations

- Process names come from `lsof`, keyed on protocol and local port. Polling runs
  every 2 s when idle and every 1 s (plus an immediate poll) while a new flow is
  unattributed. Connections that close before a poll can stay `—`, UDP ephemeral
  port reuse can misattribute a flow, and without root `lsof` only sees your own
  sockets.
- Flows to the same resolved hostname merge into one flight across IPv4 and IPv6,
  and hostless IPv6 flows merge within their `/64`. A v4 and v6 pair to the same
  server shows as two flights until a hostname resolves.
- App colors come from a brand table in `src/lib/livery.ts`. Unknown apps get a
  stable hashed color, and system processes render gray.

## Development

```bash
npm run check          # tsc (app + server), eslint, vitest
npx vitest run --coverage
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data flow and module layout, and
[TESTING.md](TESTING.md) for live verification steps (process tree, attribution,
privilege paths).

Stack: Vite, React, strict TypeScript, Tailwind v4, shadcn/ui, Zustand, MapLibre GL
(2D), react-globe.gl and three.js (3D, lazy-loaded), `ws`, geoip-lite.

## Credits and data licenses

- Basemap tiles and style © [CARTO](https://carto.com/attributions), map data
  © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- This product includes GeoLite2 data created by MaxMind, via
  [geoip-lite](https://github.com/geoip-lite/node-geoip)
- Globe textures from [three-globe](https://github.com/vasturiano/three-globe)
  (MIT; NASA Visible Earth imagery), vendored in `public/textures/`
- Country shapes from [Natural Earth](https://www.naturalearthdata.com/) (public
  domain, 110m admin-0), vendored in `public/geo/`
- UI: [shadcn/ui](https://ui.shadcn.com), [lucide](https://lucide.dev),
  [MapLibre GL JS](https://maplibre.org),
  [react-globe.gl](https://github.com/vasturiano/react-globe.gl)

MIT licensed. See [LICENSE](LICENSE).
