import { useEffect, useRef, useState } from 'react';
import { Menu, Map as MapIcon, Globe, Pin, PinOff, Download } from 'lucide-react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { useRenderQueue } from '@/hooks/useRenderQueue';
import { useBackendStore } from '@/store/backend';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1048576).toFixed(2)} MB/s`;
}

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
  console.log(`[netport-radar] session log — ${flights.length} flights\n${lines}`);
  const blob = new Blob([lines], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `netport-radar-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
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
  const toggleCardAnchor = useFiltersStore((s) => s.toggleCardAnchor);
  const cardMode = useFiltersStore((s) => (s.viewMode === '2d' ? s.cardAnchor2d : s.cardAnchor3d));
  const backend = useBackendStore((s) => s.backend);
  const demo = import.meta.env.VITE_DEMO === '1';
  const dpi = demo ? 'demo' : backend ? (backend.dpiMode === 'full' ? 'tshark' : 'port-based') : '…';
  const iface = demo ? 'demo' : backend?.iface ?? '…';

  const inRef = useRef<number[]>([]);
  const outRef = useRef<number[]>([]);
  const inCanvas = useRef<HTMLCanvasElement>(null);
  const outCanvas = useRef<HTMLCanvasElement>(null);
  const [rates, setRates] = useState({ down: 0, up: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      const flights = useFlightsStore.getState().flights;
      let total = 0;
      for (const f of flights) {
        if (f.phase === 'cruise' || f.phase === 'descent' || f.phase === 'hold') {
          total += f.bytesPerSec;
        }
      }
      const down = total * 0.85;
      const up = total * 0.15;
      pushSample(inRef.current, down);
      pushSample(outRef.current, up);
      drawSpark(inCanvas.current, '#22c55e', inRef.current);
      drawSpark(outCanvas.current, '#3b82f6', outRef.current);
      setRates({ down, up });
    }, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black/85 px-3 py-1.5 font-mono text-[11px] text-zinc-300 backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-emerald-400">↓</span>
        <canvas ref={inCanvas} width={40} height={16} className="opacity-90" />
        <span className="w-[58px] text-zinc-400">{fmtRate(rates.down)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-blue-400">↑</span>
        <canvas ref={outCanvas} width={40} height={16} className="opacity-90" />
        <span className="w-[58px] text-zinc-400">{fmtRate(rates.up)}</span>
      </div>

      <div className="text-zinc-200">
        ✈ {active}
        {offScreenCount > 0 && <span className="text-zinc-500"> (+{offScreenCount} off-screen)</span>}
      </div>

      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">DPI: {dpi}</span>

      <Select value={iface}>
        <SelectTrigger className="w-[74px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={iface}>{iface}</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <StripButton onClick={toggleFilterDrawer} label="Filters">
          <Menu />
        </StripButton>
        <StripButton onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')} label="2D / 3D">
          {viewMode === '2d' ? <MapIcon /> : <Globe />}
        </StripButton>
        <StripButton
          onClick={toggleCardAnchor}
          label={`Flight card: ${cardMode}`}
        >
          {cardMode === 'anchored' ? <Pin /> : <PinOff />}
        </StripButton>
        <StripButton onClick={exportLog} label="Export log">
          <Download />
        </StripButton>
      </div>
    </div>
  );
}
