import { useEffect, useLayoutEffect, useRef } from 'react';
import { Pin, PinOff, X } from 'lucide-react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { useBackendStore } from '@/store/backend';
import { mapRef, globeRef, flightCardRef } from '@/lib/view-refs';
import { flightWorldPos } from '@/lib/flight-pos';
import { horizonMargin } from '@/lib/globe-horizon';
import { liveProgress } from '@/lib/anim';
import { protocolBadgeClass, PROTOCOL_LABELS } from '@/lib/classify';
import { PHASE_META, progressCaption } from '@/lib/phase';
import { fmtBytes, fmtRate, fmtDur, dpiLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { geoPlaceLabel } from '@/lib/geo-display';
import type { Flight, HomeAirport } from '@/types';

// Width leaves room for the board beside it in the bottom row:
// 360px board + 2×16px padding + 8px gap + 8px slack (300px board below 900px).
const CARD_CLASS =
  'hud-panel pointer-events-auto z-30 w-[340px] max-w-[min(340px,calc(100vw-408px))] overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950/95 shadow-2xl ring-1 ring-black/40 backdrop-blur-sm max-[900px]:max-w-[min(340px,calc(100vw-348px))] max-[700px]:w-full max-[700px]:max-w-full';

interface ScreenPos {
  x: number;
  y: number;
  opacity: number;
}

function anchoredPos(f: Flight, home: HomeAirport | undefined, is2d: boolean): ScreenPos | null {
  const p = flightWorldPos(f, home, performance.now());
  if (is2d) {
    const map = mapRef.current;
    if (!map) return null;
    const pt = map.project([p.lng, p.lat]);
    return { x: pt.x, y: pt.y, opacity: 1 };
  }
  const g = globeRef.current;
  if (!g) return null;
  const sc = g.getScreenCoords(p.lat, p.lng, p.alt);
  // Fade out over a thin band as the plane slips behind the globe.
  const opacity = Math.max(0, Math.min(1, horizonMargin(g, p.lat, p.lng) / 0.05));
  return { x: sc.x, y: sc.y, opacity };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-[11px] tabular-nums text-zinc-200">{value}</div>
    </div>
  );
}

function CardBody({
  f,
  home,
  pct,
  phase,
  dpi,
  mode,
  toggleCardAnchor,
  selectFlight,
}: {
  f: Flight;
  home: HomeAirport | undefined;
  pct: number;
  phase: (typeof PHASE_META)[keyof typeof PHASE_META];
  dpi: string;
  mode: 'docked' | 'anchored';
  toggleCardAnchor: () => void;
  selectFlight: (id: string | null) => void;
}) {
  return (
    <>
      <div className="h-0.5 w-full" style={{ background: 'var(--theme-accent, #3b82f6)' }} />
      <div className="flex items-center gap-1.5 px-3 pb-2 pt-2.5">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold"
          style={{
            color: 'var(--theme-accent, #93c5fd)',
            backgroundColor: 'color-mix(in oklab, var(--theme-accent, #3b82f6) 16%, transparent)',
          }}
        >
          {f.id}
        </span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none', protocolBadgeClass(f.detectedProtocol))}>
          {PROTOCOL_LABELS[f.detectedProtocol]}
        </span>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', phase.badgeClass)}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: phase.hex }} />
          {phase.label}
        </span>
        <button
          onClick={toggleCardAnchor}
          className="ml-auto shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label={`Flight card: ${mode}`}
          title={`Flight card: ${mode}`}
        >
          {mode === 'docked' ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => selectFlight(null)}
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close flight detail"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-3 pb-2.5">
        <div className="truncate text-sm font-medium text-zinc-100" title={f.hostname || f.dstIp}>
          {f.hostname || f.dstIp}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-500">
          {[f.org, f.asn, geoPlaceLabel(f)].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-800/80 px-3 py-2 font-mono text-[11px]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] uppercase tracking-wider text-zinc-500">{home?.label ?? 'Your PC'}</div>
          <div className="truncate text-zinc-300">{f.srcIp}:{f.srcPort}</div>
        </div>
        <div className="flex shrink-0 flex-col items-center px-1 leading-none text-zinc-600">
          <span aria-hidden style={{ color: f.liveryColor }}>✈</span>
          <span className="mt-0.5 text-[9px]">{f.direction === 'inbound' ? '←' : '→'}</span>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <div className="truncate text-[10px] uppercase tracking-wider text-zinc-500">{f.country} {f.countryFlag}</div>
          <div className="truncate text-zinc-300">{f.dstIp}:{f.dstPort}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-800/80 px-3 py-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: f.liveryColor }} />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-zinc-400">{pct}%</span>
        <span className="text-[10px] text-zinc-500">{progressCaption(f.phase, f.direction)}</span>
      </div>
      <div className="grid grid-cols-4 gap-1 border-t border-zinc-800/80 px-3 py-2 text-center">
        <Stat label="Dur" value={fmtDur(f.durationMs)} />
        <Stat label="Speed" value={fmtRate(f.bytesPerSec)} />
        <Stat label="TX" value={fmtBytes(f.bytesTx)} />
        <Stat label="RX" value={fmtBytes(f.bytesRx)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-zinc-800/80 px-3 py-1.5 font-mono text-[10px] text-zinc-500">
        <span className="text-zinc-400">{f.process}</span>
        <span>PID {f.pid}</span>
        <span>· DPI {dpi}</span>
        {f.sni && <span className="truncate">· SNI {f.sni}</span>}
        <span>· {f.packetsTotal.toLocaleString()} pkts</span>
      </div>
    </>
  );
}

export default function FlightCard() {
  const flights = useFlightsStore((s) => s.flights);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectFlight = useFlightsStore((s) => s.selectFlight);
  const viewMode = useFiltersStore((s) => s.viewMode);
  const mode = useFiltersStore((s) => (s.viewMode === '2d' ? s.cardAnchor2d : s.cardAnchor3d));
  const toggleCardAnchor = useFiltersStore((s) => s.toggleCardAnchor);
  const backend = useBackendStore((s) => s.backend);
  const dpi = dpiLabel(backend, import.meta.env.VITE_DEMO === '1', '—');

  const cardRef = useRef<HTMLDivElement>(null);

  // Publish ref for LeaderLine (docked card position).
  useLayoutEffect(() => {
    const el = cardRef.current;
    flightCardRef.current = el;
    return () => {
      if (flightCardRef.current === el) flightCardRef.current = null;
    };
  });

  // Anchored mode: track the plane every frame without re-rendering card content.
  useEffect(() => {
    if (mode === 'docked') return;
    const el = cardRef.current;
    if (!el || !selectedId) return;
    let raf = 0;
    const tick = () => {
      const st = useFlightsStore.getState();
      const fl = st.flights.find((x) => x.id === selectedId);
      const sp = fl
        ? anchoredPos(fl, st.homeAirports.find((a) => a.id === fl.homeAirportId), viewMode === '2d')
        : null;
      if (sp) {
        el.style.left = `${sp.x}px`;
        el.style.top = `${sp.y}px`;
        el.style.transform = 'translate(-50%, calc(-100% - 16px))';
        el.style.opacity = String(sp.opacity);
        el.style.pointerEvents = sp.opacity < 0.15 ? 'none' : 'auto';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, selectedId, viewMode]);

  const f = flights.find((x) => x.id === selectedId);
  if (!f) {
    // Keep the flex slot so the board stays pinned left.
    return <div className="min-w-0 flex-1" aria-hidden />;
  }

  const home = homeAirports.find((a) => a.id === f.homeAirportId);
  const pct = Math.round(liveProgress(f) * 100);
  const phase = PHASE_META[f.phase];
  const body = (
    <CardBody
      f={f}
      home={home}
      pct={pct}
      phase={phase}
      dpi={dpi}
      mode={mode}
      toggleCardAnchor={toggleCardAnchor}
      selectFlight={selectFlight}
    />
  );

  // Docked: bottom-right on medium widths, centered once there's room, and
  // never overlapping the board (both live in one flex row).
  if (mode === 'docked') {
    return (
      <div className="flex min-w-0 flex-1 justify-end min-[1300px]:justify-center">
        <div
          ref={cardRef}
          role="dialog"
          aria-label={`Flight ${f.id} — ${f.hostname || f.dstIp}`}
          className={CARD_CLASS}
        >
          {body}
        </div>
      </div>
    );
  }

  // Anchored: fixed overlay tracking the selected plane on the map/globe.
  return (
    <div className="min-w-0 flex-1">
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`Flight ${f.id} — ${f.hostname || f.dstIp}`}
        className={cn(CARD_CLASS, 'fixed')}
        style={{ left: 0, top: 0, opacity: 0 }}
      >
        {body}
      </div>
    </div>
  );
}
