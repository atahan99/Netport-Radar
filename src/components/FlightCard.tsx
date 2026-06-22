import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { liveProgress } from '@/lib/anim';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { useBackendStore } from '@/store/backend';
import { mapRef, globeRef } from '@/lib/view-refs';
import { flightEndpoints } from '@/lib/arc';
import { interpolateArc } from '@/lib/interpolate';
import { protocolBadgeClass, PROTOCOL_LABELS } from '@/lib/classify';
import { PHASE_META } from '@/lib/phase';
import { fmtBytes, fmtRate, fmtDur } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Flight, HomeAirport } from '@/types';

const GLOBE_R = 100;

interface ScreenPos {
  x: number;
  y: number;
  opacity: number; // eases to 0 as the plane nears/passes the globe's horizon
}

function anchoredPos(f: Flight, home: HomeAirport | undefined, is2d: boolean): ScreenPos | null {
  const ep = flightEndpoints(home, f);
  const p = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, liveProgress(f));
  if (is2d) {
    const map = mapRef.current;
    if (!map) return null;
    const pt = map.project([p.lng, p.lat]);
    return { x: pt.x, y: pt.y, opacity: 1 };
  }
  const g = globeRef.current;
  if (!g) return null;
  const sc = g.getScreenCoords(p.lat, p.lng, 0.02);
  let opacity = 1;
  try {
    const P = g.getCoords(p.lat, p.lng, 0);
    const C = g.camera().position;
    // margin > 0 = front of the horizon, < 0 = behind the globe. Fade across a
    // thin band just inside the limb so the card doesn't pop.
    const margin = P.x * C.x + P.y * C.y + P.z * C.z - GLOBE_R * GLOBE_R;
    const band = GLOBE_R * GLOBE_R * 0.05;
    opacity = Math.max(0, Math.min(1, margin / band));
  } catch {
    /* keep visible */
  }
  return { x: sc.x, y: sc.y, opacity };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="font-mono text-[11px] tabular-nums text-zinc-200">{value}</div>
    </div>
  );
}

export default function FlightCard() {
  const flights = useFlightsStore((s) => s.flights);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectFlight = useFlightsStore((s) => s.selectFlight);
  const viewMode = useFiltersStore((s) => s.viewMode);
  const mode = useFiltersStore((s) => (s.viewMode === '2d' ? s.cardAnchor2d : s.cardAnchor3d));
  const backend = useBackendStore((s) => s.backend);
  const dpi =
    import.meta.env.VITE_DEMO === '1'
      ? 'demo'
      : backend
        ? backend.dpiMode === 'full'
          ? 'tshark'
          : 'port-based'
        : '—';

  // Position the card imperatively so the anchored mode tracks its plane every
  // frame without re-rendering the card content (which stays at the 10Hz store).
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const dock = () => {
      el.style.left = '50%';
      el.style.top = '';
      el.style.bottom = '16px';
      el.style.transform = 'translateX(-50%)';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    };
    if (mode === 'docked' || !selectedId) {
      dock();
      return;
    }
    let raf = 0;
    const tick = () => {
      const st = useFlightsStore.getState();
      const fl = st.flights.find((x) => x.id === selectedId);
      const sp = fl
        ? anchoredPos(fl, st.homeAirports.find((a) => a.id === fl.homeAirportId), viewMode === '2d')
        : null;
      if (sp) {
        el.style.left = `${sp.x}px`;
        el.style.bottom = '';
        el.style.top = `${sp.y}px`;
        el.style.transform = 'translate(-50%, calc(-100% - 16px))';
        el.style.opacity = String(sp.opacity);
        el.style.pointerEvents = sp.opacity < 0.15 ? 'none' : 'auto';
      } else {
        dock(); // projection unavailable → fall back to the docked spot
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, selectedId, viewMode]);

  const f = flights.find((x) => x.id === selectedId);
  if (!f) return null;

  const home = homeAirports.find((a) => a.id === f.homeAirportId);
  const pct = Math.round(liveProgress(f) * 100);

  const phase = PHASE_META[f.phase];

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`Flight ${f.id} — ${f.hostname || f.dstIp}`}
      className="pointer-events-auto absolute z-30 w-[340px] overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950/95 shadow-2xl ring-1 ring-black/40 backdrop-blur-sm"
      style={{ left: '50%', bottom: 16, transform: 'translateX(-50%)' }}
    >
      {/* Accent hairline — tinted by the active theme */}
      <div className="h-0.5 w-full" style={{ background: 'var(--theme-accent, #3b82f6)' }} />

      {/* Header: callsign · protocol · phase · close */}
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
          onClick={() => selectFlight(null)}
          className="ml-auto shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close flight detail"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Hero: destination hostname + org/asn/city */}
      <div className="px-3 pb-2.5">
        <div className="truncate text-sm font-medium text-zinc-100" title={f.hostname || f.dstIp}>
          {f.hostname || f.dstIp}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-500">
          {[f.org, f.asn, [f.city, f.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      {/* Route: your PC ✈ destination */}
      <div className="flex items-center gap-2 border-t border-zinc-800/80 px-3 py-2 font-mono text-[11px]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[9px] uppercase tracking-wider text-zinc-600">{home?.label ?? 'Your PC'}</div>
          <div className="truncate text-zinc-300">{f.srcIp}:{f.srcPort}</div>
        </div>
        <div className="flex shrink-0 flex-col items-center px-1 leading-none text-zinc-600">
          <span aria-hidden style={{ color: f.liveryColor }}>✈</span>
          <span className="mt-0.5 text-[9px]">{f.direction === 'inbound' ? '←' : '→'}</span>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <div className="truncate text-[9px] uppercase tracking-wider text-zinc-600">{f.country} {f.countryFlag}</div>
          <div className="truncate text-zinc-300">{f.dstIp}:{f.dstPort}</div>
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 border-t border-zinc-800/80 px-3 py-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: f.liveryColor }} />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-zinc-400">{pct}%</span>
        <span className="text-[10px] text-zinc-500">{f.direction === 'inbound' ? 'Arriving' : 'Departing'}</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-1 border-t border-zinc-800/80 px-3 py-2 text-center">
        <Stat label="Dur" value={fmtDur(f.durationMs)} />
        <Stat label="Speed" value={fmtRate(f.bytesPerSec)} />
        <Stat label="TX" value={fmtBytes(f.bytesTx)} />
        <Stat label="RX" value={fmtBytes(f.bytesRx)} />
      </div>

      {/* Footer meta */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-zinc-800/80 px-3 py-1.5 font-mono text-[10px] text-zinc-600">
        <span className="text-zinc-400">{f.process}</span>
        <span>PID {f.pid}</span>
        <span>· DPI {dpi}</span>
        {f.sni && <span className="truncate">· SNI {f.sni}</span>}
        <span>· {f.packetsTotal.toLocaleString()} pkts</span>
      </div>
    </div>
  );
}
