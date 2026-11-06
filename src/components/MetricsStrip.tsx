import { useEffect, useRef, useState } from 'react';
import { Menu, Map as MapIcon, Globe, Download, CircleHelp, Stethoscope } from 'lucide-react';
import { downloadFile } from '@/lib/utils';
import { legendSeen, markLegendSeen } from '@/lib/legend-hint';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { filterChips } from '@/lib/filter-chips';
import { THEMES, type ThemeName } from '@/lib/themes';
import { useRenderQueue } from '@/hooks/useRenderQueue';
import { useBackendStore } from '@/store/backend';
import { Button } from '@/components/ui/button';
import { liveControl } from '@/lib/live';
import { fmtRate } from '@/lib/format';
import { exportDiagnostics, useDiagnosticsStore } from '@/store/diagnostics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function pushSample(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > 60) arr.shift();
}

function drawSpark(canvas: HTMLCanvasElement | null, color: string, data: number[]) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...data);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / 59) * w;
    const y = h - (v / max) * (h - 2) - 1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function exportLog() {
  const flights = useFlightsStore.getState().flights;
  const lines = flights
    .map((f) =>
      JSON.stringify({
        t: f.startedAt,
        id: f.id,
        process: f.process,
        proto: f.detectedProtocol,
        dst: f.dstIp,
        country: f.country,
        city: f.city,
        org: f.org,
        asn: f.asn,
        hostname: f.hostname,
        aircraft: f.aircraftType,
        homeAirport: f.homeAirportId,
        bytesTotal: f.bytesTotal,
        durationMs: Math.round(f.durationMs),
        isLan: f.isLan,
      }),
    )
    .join('\n');
  downloadFile(lines, 'application/x-ndjson', 'ndjson');
}

function StripButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {children}
    </button>
  );
}

export default function MetricsStrip() {
  const { mainQueue, dnsQueue, offScreenCount } = useRenderQueue();
  const active = mainQueue.length + dnsQueue.length;

  const viewMode = useFiltersStore((s) => s.viewMode);
  const setViewMode = useFiltersStore((s) => s.setViewMode);
  const toggleFilterDrawer = useFiltersStore((s) => s.toggleFilterDrawer);
  const toggleLegend = useFiltersStore((s) => s.toggleLegend);
  const [legendHint, setLegendHint] = useState(() => !legendSeen());
  // Narrow screens: the strip scrolls. Start scrolled to the end so the
  // controls are visible; the metrics are a swipe away.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const theme = useFiltersStore((s) => s.theme);
  const setTheme = useFiltersStore((s) => s.setTheme);
  const hasActiveFilters = useFiltersStore((s) => filterChips(s).length > 0);
  const backend = useBackendStore((s) => s.backend);
  const demo = import.meta.env.VITE_DEMO === '1';
  const dpi = demo ? 'demo' : backend ? (backend.dpiMode === 'full' ? 'tshark' : 'port-based') : '…';
  const iface = demo ? 'demo' : backend?.iface ?? '…';
  const online = useBackendStore((s) => s.online);
  const diagEntries = useDiagnosticsStore((s) => s.entries.length);
  const wsState = useDiagnosticsStore((s) => s.wsState);
  const lastWsClose = useDiagnosticsStore((s) => s.lastWsClose);
  const chunkErrors = useDiagnosticsStore((s) => s.chunkErrors.length);
  const ifaceOptions = demo ? ['demo'] : backend?.interfaces?.length ? backend.interfaces : [iface];
  const [pendingIface, setPendingIface] = useState<string | null>(null);

  const doExport = () => (online ? liveControl.send({ type: 'export' }) : exportLog());
  const doSwitch = (withExport: boolean) => {
    if (pendingIface) {
      if (withExport) liveControl.send({ type: 'export' });
      liveControl.send({ type: 'switch_iface', iface: pendingIface });
    }
    setPendingIface(null);
  };

  const inRef = useRef<number[]>([]);
  const outRef = useRef<number[]>([]);
  const inCanvas = useRef<HTMLCanvasElement>(null);
  const outCanvas = useRef<HTMLCanvasElement>(null);
  const prevBytes = useRef<Map<string, { tx: number; rx: number }>>(new Map());
  const [rates, setRates] = useState({ down: 0, up: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      // Real ↓/↑: sum the per-flow growth in received (rx) and sent (tx) bytes
      // since the last tick. ×2 turns a 500ms delta into a per-second rate.
      const flights = useFlightsStore.getState().flights;
      const prev = prevBytes.current;
      const next = new Map<string, { tx: number; rx: number }>();
      let upDelta = 0;
      let downDelta = 0;
      for (const f of flights) {
        next.set(f.id, { tx: f.bytesTx, rx: f.bytesRx });
        const p = prev.get(f.id);
        if (p) {
          upDelta += Math.max(0, f.bytesTx - p.tx);
          downDelta += Math.max(0, f.bytesRx - p.rx);
        }
      }
      prevBytes.current = next;
      const down = downDelta * 2;
      const up = upDelta * 2;
      pushSample(inRef.current, down);
      pushSample(outRef.current, up);
      drawSpark(inCanvas.current, '#22c55e', inRef.current);
      drawSpark(outCanvas.current, '#3b82f6', outRef.current);
      setRates({ down, up });
    }, 500);
    return () => clearInterval(id);
  }, []);

  const diagHint =
    chunkErrors > 0
      ? `${chunkErrors} chunk load error(s)`
      : lastWsClose && lastWsClose.code !== 1000
        ? `WS closed (${lastWsClose.code})`
        : wsState === 'disconnected'
          ? 'WS disconnected'
          : null;

  return (
    <>
    <div className="flex max-w-full flex-col items-end gap-1">
    <div ref={stripRef} className="flex h-10 max-w-full flex-nowrap items-center justify-start gap-x-3 overflow-x-auto rounded-xl border border-zinc-800 bg-black/85 px-3 font-mono text-[11px] text-zinc-300 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-emerald-400">↓</span>
        <canvas ref={inCanvas} width={40} height={16} className="block h-4 w-10 shrink-0 opacity-90" />
        <span className="w-[58px] shrink-0 text-zinc-400">{fmtRate(rates.down)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-blue-400">↑</span>
        <canvas ref={outCanvas} width={40} height={16} className="block h-4 w-10 shrink-0 opacity-90" />
        <span className="w-[58px] shrink-0 text-zinc-400">{fmtRate(rates.up)}</span>
      </div>

      <div className="shrink-0 whitespace-nowrap text-zinc-200">
        ✈ {active}
        {offScreenCount > 0 && <span className="text-zinc-500"> (+{offScreenCount} off-screen)</span>}
      </div>

      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">DPI: {dpi}</span>

      <Select
        value={iface}
        onValueChange={(v) => {
          if (v !== iface && !demo) setPendingIface(v);
        }}
      >
        <SelectTrigger className="h-7 w-[74px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ifaceOptions.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={theme} onValueChange={(v) => setTheme(v as ThemeName)}>
        <SelectTrigger className="h-7 w-[96px] shrink-0" aria-label="Color theme">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEMES.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="relative">
          <StripButton onClick={toggleFilterDrawer} label="Filters">
            <Menu />
          </StripButton>
          {hasActiveFilters && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
          )}
        </div>
        <div className="relative">
          <StripButton
            onClick={() => {
              markLegendSeen();
              setLegendHint(false);
              toggleLegend();
            }}
            label="Legend"
          >
            <CircleHelp />
          </StripButton>
          {legendHint && (
            <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-sky-400/70 motion-safe:animate-pulse" />
          )}
        </div>
        <StripButton onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')} label="2D / 3D">
          {viewMode === '2d' ? <MapIcon /> : <Globe />}
        </StripButton>
        <StripButton onClick={doExport} label="Export log">
          <Download />
        </StripButton>
        <StripButton onClick={exportDiagnostics} label="Export diagnostics">
          <Stethoscope />
        </StripButton>
      </div>
    </div>
    {diagHint && (
      <div
        className="rounded-md border border-amber-900/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300"
        title={diagEntries ? `${diagEntries} diagnostic event(s) recorded` : undefined}
      >
        {diagHint}
      </div>
    )}
    </div>
      {pendingIface && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onClick={() => setPendingIface(null)}
        >
          <div
            className="w-[320px] rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Confirm switch to ${pendingIface}`}
          >
            <div className="text-sm font-medium text-zinc-100">Switch to {pendingIface}?</div>
            <div className="mt-1 text-xs text-zinc-400">This clears the current session.</div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPendingIface(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="outline" onClick={() => doSwitch(true)}>
                Export &amp; switch
              </Button>
              <Button size="sm" onClick={() => doSwitch(false)}>
                Switch
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
