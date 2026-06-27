# netport-radar

Visualization-only local network monitor. Your machine is an airport; every
connection is a flight flying an animated great-circle arc on a dark world map
(or 3D globe) toward the remote IP's country. Read-only — no blocking, no
firewall. Capture + DPI run locally.

## Run (live capture)

```bash
npm install
sudo npm start          # build UI + start capture, opens http://localhost:8080
```

`npm start` builds the frontend, starts the Node capture backend (tshark →
tcpdump fallback), serves the UI on :8080 and streams flights over ws :8090.
Raw capture needs root on macOS/Linux (BPF); on macOS you can instead activate
Wireshark's **ChmodBPF** to capture without sudo.

### Dev (two terminals)

```bash
npm run dev             # Vite UI on http://localhost:5173
sudo npm run server     # capture backend + ws on :8090
```

### Demo mode (no backend, simulated data)

```bash
VITE_DEMO=1 npm run dev
```

## Requirements

- **tshark** (install Wireshark) — preferred, full DPI. Falls back to **tcpdump**
  (built into macOS/Linux, port-based detection). The metrics strip shows which
  via the `DPI:` indicator.
- Capture permission: run with `sudo`, or on macOS activate ChmodBPF.

## Home location

Behind NAT your source IP is private and can't be geolocated, so the home
airport is placed from your **public IP** — one lookup via `ip-api.com`
(city-accurate; the only outbound request the app makes). To skip it and set
your location manually:

```bash
sudo NETPORT_HOME_LAT=41.01 NETPORT_HOME_LNG=28.97 NETPORT_HOME_LABEL="Istanbul, TR" npm start
```

## Controls

- **Click** a plane or a departures/arrivals row → flight card
- **[≡]** filters · **[⊞]** 2D / 3D · **pin** = flight-card anchor ↔ dock
- (demo only) **R** reconnect overlay · **B** burst ~200 flights

## Stack

Vite · React · TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand ·
MapLibre GL (2D) · react-globe.gl + three (3D) · ws · geoip-lite.

## Status

Phases 1 (demo UI), 2 (3D globe), 3 (live capture) complete. Next: Phase 4 —
process attribution (real app names + brand livery via lsof/netstat, NDJSON log
export, live interface switching) · Phase 5 — polish + ship.
```
