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
import { cn } from '@/lib/utils';
import type { Flight, HomeAirport } from '@/types';

const GLOBE_R = 100;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1048576).toFixed(2)} MB/s`;
}
function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

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

  return (
    <div
      ref={cardRef}
      className="pointer-events-auto absolute z-30 w-[320px] rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-2xl backdrop-blur-sm"
      style={{ left: '50%', bottom: 16, transform: 'translateX(-50%)' }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap rounded bg-blue-950 px-1.5 py-0.5 font-mono text-xs text-blue-300">
            {f.id}
          </span>
          <span className={cn('shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-none', protocolBadgeClass(f.detectedProtocol))}>
            {PROTOCOL_LABELS[f.detectedProtocol]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right text-[11px] text-zinc-400">
            {f.process} · PID {f.pid}
          </div>
          <button
            onClick={() => selectFlight(null)}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 py-1.5 text-[11px] text-zinc-500">
        {f.direction === 'inbound' ? 'Arriving' : 'Departing'}: {home?.label ?? '—'} · DPI: {dpi} · SNI:{' '}
        {f.sni ?? '—'}
      </div>

      <div className="flex items-center justify-between border-y border-zinc-800 px-3 py-2 font-mono text-[11px] text-zinc-400">
        <div>
          <div className="text-zinc-200">YOUR PC</div>
          <div>{f.srcIp}:{f.srcPort}</div>
        </div>
        <div className="px-2 text-zinc-600">——✈——</div>
        <div className="text-right">
          <div className="text-zinc-200">{f.country} {f.countryFlag}</div>
          <div>{f.dstIp}:{f.dstPort}</div>
        </div>
      </div>

      <div className="px-3 py-2 text-xs">
        <div className="truncate text-zinc-300">
          {f.hostname} · {f.org} · {f.asn}
        </div>
        <div className="text-zinc-500">{f.city}, {f.country}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: f.liveryColor }} />
          </div>
          <span className="font-mono text-[10px] text-zinc-500">{pct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 border-t border-zinc-800 px-3 py-2 text-center font-mono text-[11px]">
        <div>
          <div className="text-zinc-500">Dur</div>
          <div className="text-zinc-200">{fmtDur(f.durationMs)}</div>
        </div>
        <div>
          <div className="text-zinc-500">Speed</div>
          <div className="text-zinc-200">{fmtRate(f.bytesPerSec)}</div>
        </div>
        <div>
          <div className="text-zinc-500">TX</div>
          <div className="text-zinc-200">{fmtBytes(f.bytesTx)}</div>
        </div>
        <div>
          <div className="text-zinc-500">RX</div>
          <div className="text-zinc-200">{fmtBytes(f.bytesRx)}</div>
        </div>
      </div>
      <div className="px-3 pb-2 font-mono text-[10px] text-zinc-500">
        Packets: {f.packetsTotal.toLocaleString()} · {f.phase.toUpperCase()}
      </div>
    </div>
  );
}
