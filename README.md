# netport-radar

Visualization-only local network monitor. Your machine is an airport; every
connection is a flight flying an animated great-circle arc on a dark world map
(or 3D globe) toward the remote IP's country. Read-only — no blocking, no
firewall. Capture + DPI run locally.

<!-- Demo recording is a manual step: capture ~15s of real traffic (map + globe,
     a flight card open, the filter drawer) and save it to docs/demo.gif, then
     uncomment the line below. -->
<!-- ![netport-radar demo](docs/demo.gif) -->

> _A short demo GIF goes at `docs/demo.gif` — see [Demo recording](#demo-recording)._

## Run (live capture)

```bash
npm install
sudo npm start          # build UI + start capture, opens http://localhost:8080
```

`npm start` builds the frontend, starts the Node capture backend (tshark →
tcpdump fallback), serves the UI on :8080 and streams flights over ws :8090.
Raw packet capture needs elevated permission — see your platform below.

## Platform setup

The backend prefers **tshark** (from Wireshark; full deep-packet inspection for
SNI/hostnames) and falls back to **tcpdump** (port-based protocol guessing). The
metrics strip's `DPI:` indicator shows which is active.

### macOS

```bash
brew install --cask wireshark      # provides tshark
sudo npm start                     # capture needs root (BPF devices)
```

To capture **without** `sudo`, install Wireshark's **ChmodBPF** helper (Wireshark
→ *Install ChmodBPF* on first launch, or the bundled installer). It grants your
user access to the `/dev/bpf*` devices; then `npm start` works unprivileged.

### Linux

```bash
sudo apt install tshark            # or: dnf install wireshark-cli
sudo npm start
```

To capture **without** `sudo`, grant the capture capabilities to the binaries:

```bash
sudo setcap cap_net_raw,cap_net_admin=eip "$(command -v dumpcap)"
sudo setcap cap_net_raw,cap_net_admin=eip "$(command -v tcpdump)"
```

(`dumpcap` is the privileged helper tshark spawns.) Then run `npm start` as your
normal user.

### Windows

1. Install **Wireshark**, and during setup install **Npcap** (check *"WinPcap API
   compatible"*).
2. Run from an **Administrator** terminal (Npcap raw capture requires admin):

   ```powershell
   npm start
   ```

> tcpdump-only platforms get port-based protocol detection (no SNI/hostnames).
> Install Wireshark/tshark for the full DPI view.

### Dev (two terminals)

```bash
npm run dev             # Vite UI on http://localhost:5173
sudo npm run server     # capture backend + ws on :8090
```

### Demo mode (no backend, simulated data)

```bash
VITE_DEMO=1 npm run dev
```

## Home location

Behind NAT your source IP is private and can't be geolocated, so the home
airport is placed from your **public IP** — one lookup per session
(HTTPS-first: `ipapi.co`, falling back to `ip-api.com`, then `ipify` + the
local GeoIP database). That's the only outbound request the app makes. To skip
it and set your location manually:

```bash
sudo NETPORT_HOME_LAT=41.01 NETPORT_HOME_LNG=28.97 NETPORT_HOME_LABEL="Istanbul, TR" npm start
```

## Better geo (optional)

By default, destination countries come from the bundled GeoLite2 database
(country-accurate, no ASN/org). For **city-accurate destinations + real
ASN/org** on the flight card, point the app at MaxMind GeoLite2 `.mmdb` files
(free account, you download them — nothing is bundled):

```bash
sudo NETPORT_MMDB_CITY=~/GeoLite2-City.mmdb \
     NETPORT_MMDB_ASN=~/GeoLite2-ASN.mmdb npm start
```

If a file is missing or unreadable, it silently falls back to the bundled DB.

## Security model

This tool watches your traffic, so its own surface is kept deliberately small
(details in [ARCHITECTURE.md](ARCHITECTURE.md)):

- The capture server (ws `:8090`) and UI server (`:8080`) bind
  **127.0.0.1 only** — nothing on your network can reach them.
- WebSocket connections from web pages are allowed only from **localhost
  origins**, so a random website open in your browser can't read your traffic
  feed (browsers don't apply CORS to WebSockets — this gate matters).
- Want the dashboard on another device? `NETPORT_BIND=0.0.0.0 sudo npm start`
  prints a tokenized URL (`http://<your-ip>:8080/?token=…`); every WS
  connection must present that per-boot token.
- Read-only by construction: the capture path never blocks, injects, or
  modifies traffic. Everything stays on your machine except the single
  geolocation lookup above.

## Controls

- **Click** a plane or a departures/arrivals row → flight card
- **[≡]** filters · **[⊞]** 2D / 3D · **pin** = flight-card anchor ↔ dock
- (demo only) **R** reconnect overlay · **B** burst ~200 flights

## Troubleshooting

The UI surfaces capture problems directly:

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Blocking "No capture backend found" | neither tshark nor tcpdump is installed | install Wireshark (see your platform above) |
| Blocking "Port 8090 is already in use" | another netport-radar (or process) holds the ws port | `lsof -ti tcp:8090 \| xargs kill`, then restart |
| Amber "No capture permission" banner | the ws is up but capture can't read packets | run with `sudo`, or set up ChmodBPF / `setcap` above |
| "Reconnecting…" overlay | the ws connection to the backend dropped | the client auto-retries every 3s; check the server is running |
| Transient warning toast | a mid-session capture hiccup (e.g. interface went down) | usually self-recovers; switch interface from the metrics strip if not |

## Demo recording

The README demo is a manual capture (no real traffic is bundled). With the app
running on live traffic:

1. Record ~15s showing the 2D map with flights flying, a switch to the 3D globe,
   a flight card open (process + live SNI), and the filter drawer.
2. Save as `docs/demo.gif` (or `.mp4`/`.webm`).
3. Uncomment the image line near the top of this README.

## Stack

Vite · React · TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand ·
MapLibre GL (2D) · react-globe.gl + three (3D, lazy-loaded) · ws · geoip-lite.

## Credits & data licenses

- Basemap tiles & style © [CARTO](https://carto.com/attributions), data
  © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- This product includes GeoLite2 data created by MaxMind
  (via [geoip-lite](https://github.com/geoip-lite/node-geoip))
- Globe textures from [three-globe](https://github.com/vasturiano/three-globe)
  (MIT; NASA visible-earth imagery), vendored in `public/textures/`
- UI pieces: [shadcn/ui](https://ui.shadcn.com) · [lucide](https://lucide.dev)
  icons · [MapLibre GL JS](https://maplibre.org) ·
  [react-globe.gl](https://github.com/vasturiano/react-globe.gl)

Licensed MIT — see [LICENSE](LICENSE).

## Status

**Shipped.** Built in ten phases: demo UI → 3D globe → live capture → process
attribution → polish → **security hardening** (loopback bind, WS origin/token
gate) → **data honesty** (real ↓/↑, tcpdump closes, CGNAT, self-noise drops) →
**perf architecture** (per-frame animation channel, HUD at 10Hz, eslint 0) →
**test suite** (vitest, ~80 tests, 77% logic coverage) → **UX & a11y** (legend,
filter chips, hover tooltips, keyboard nav, prefers-reduced-motion). Quality
gate: `npm run check` (tsc ×2 + eslint + vitest). Electron was dropped — the app
ships as `sudo npm start`.
