# netport-radar

Visualization-only local network monitor. Your machine is an airport; every
connection is a flight flying an animated great-circle arc on a dark world map
(or 3D globe) toward the remote IP's country. Read-only — no blocking, no
firewall, nothing leaves the machine.

**Phase 1 — demo mode.** The full UI running on simulated data. No backend,
no packet capture yet (those are Phases 3–4).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

## Stack

Vite + React + TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand ·
MapLibre GL (2D map) · react-globe.gl (3D globe).

## Demo controls

- **Click** a plane or a departures/arrivals row → flight card
- **[≡]** filter drawer · **[⊞]** 2D / 3D · **pin icon** = flight-card
  anchor ↔ dock toggle (2D defaults to anchored, globe to docked)
- **R** = reconnecting overlay · **B** = burst ~200 flights (exercises the
  150-flight render cap + off-screen counter)

## Project docs

- `netport-master-plan.md` — full architecture + locked decisions
- `netport-phase1-prompt-final.md` — Phase 1 spec
- Remaining: Phase 2 globe polish · 3 live capture (tshark/tcpdump) ·
  4 process attribution · 5 polish + ship
