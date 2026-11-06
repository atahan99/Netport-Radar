import { X } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { AIRCRAFT_ICONS } from '@/lib/icons';
import { PHASE_META, PHASE_ORDER } from '@/lib/phase';
import { LIVERY_COLORS } from '@/lib/livery';
import type { AircraftType } from '@/types';

const AIRCRAFT: Array<[AircraftType, string]> = [
  ['widebody', 'HTTPS'],
  ['narrowbody', 'HTTP'],
  ['cargo', 'Large TCP'],
  ['helicopter', 'UDP / QUIC / gaming'],
  ['privatejet', 'VPN tunnel'],
  ['satellite', 'Long-lived bulk'],
  ['drone', 'DNS'],
  ['ambulance', 'ICMP'],
  ['stealth', 'SSH / Tor'],
  ['broadcast', 'Streaming'],
];

function Icon({ type }: { type: AircraftType }) {
  const icon = AIRCRAFT_ICONS[type];
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0 text-zinc-300">
      <path
        d={icon.d}
        fill={icon.mode === 'fill' ? 'currentColor' : 'none'}
        stroke={icon.mode === 'stroke' ? 'currentColor' : 'none'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Legend() {
  const open = useFiltersStore((s) => s.legendOpen);
  const setLegend = useFiltersStore((s) => s.setLegend);
  const demo = import.meta.env.VITE_DEMO === '1';

  // No auto-open: it covered the map on every first load. The legend button
  // pulses until the user has opened it once (MetricsStrip).
  const close = () => setLegend(false);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
      <div
        className="hud-panel hud-scroll absolute right-4 top-[4.5rem] z-40 max-h-[60vh] w-72 overflow-y-auto max-[640px]:left-4 max-[640px]:w-auto max-[640px]:max-h-[60vh] rounded-xl border border-zinc-800 bg-black/90 p-3.5 text-xs backdrop-blur-sm"
        role="dialog"
        aria-label="Legend"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-300">LEGEND</span>
          <button onClick={close} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close legend">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500">Aircraft</div>
        {/* Two columns: what the traffic is, with the aircraft type on hover. */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {AIRCRAFT.map(([type, label]) => (
            <div key={type} className="flex min-w-0 items-center gap-1.5" title={type}>
              <Icon type={type} />
              <span className="truncate text-zinc-300">{label}</span>
              <span className="sr-only">({type})</span>
            </div>
          ))}
        </div>

        <div className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-wide text-zinc-500">Phases</div>
        {/* Same colors as the board's status column, so this doubles as its key. */}
        <div className="flex flex-wrap gap-1">
          {PHASE_ORDER.map((phase) => (
            <span
              key={phase}
              title={PHASE_META[phase].meaning}
              className={`rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] ${PHASE_META[phase].textClass}`}
            >
              {PHASE_META[phase].label}
              <span className="sr-only">: {PHASE_META[phase].meaning}</span>
            </span>
          ))}
        </div>

        <div className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-wide text-zinc-500">Lines &amp; rings</div>
        <ul className="space-y-0.5 text-zinc-400">
          <li>— solid arc · - - dashed arc = VPN</li>
          <li>· · · dotted line = planned route (selected flight)</li>
          <li>○ white ring = home · ○ purple = VPN exit</li>
          <li>LAN traffic orbits home · stealth is semi-transparent</li>
          <li>?? = unknown shelf · ~CC = country-centroid guess</li>
        </ul>

        <div className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-wide text-zinc-500">Brand colors</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(LIVERY_COLORS)
            .slice(0, 24)
            .map(([name, hex]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-zinc-400"
                title={hex}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
                {name}
              </span>
            ))}
          <span className="self-center text-[10px] text-zinc-500">+{Object.keys(LIVERY_COLORS).length - 24} more</span>
        </div>

        {demo && (
          <div className="mt-3 border-t border-zinc-800 pt-2 font-mono text-[10px] text-zinc-500">
            demo: R reconnect overlay · B burst 200 flights
          </div>
        )}
      </div>
    </>
  );
}
