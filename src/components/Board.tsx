import { useFlightsStore } from '@/store/flights';
import { cn } from '@/lib/utils';
import type { Flight, FlightPhase } from '@/types';

const PHASE_STYLE: Record<FlightPhase, string> = {
  taxi: 'text-blue-400',
  cruise: 'text-emerald-400',
  hold: 'text-amber-400',
  descent: 'text-orange-400',
  landed: 'text-zinc-500',
};

export function Board({
  direction,
  title,
}: {
  direction: 'outbound' | 'inbound';
  title: string;
}) {
  const flights = useFlightsStore((s) => s.flights);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const select = useFlightsStore((s) => s.selectFlight);

  const rows = flights
    .filter((f) => f.direction === direction && f.phase !== 'landed')
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 40);

  const isVpn = (f: Flight) => homeAirports.find((a) => a.id === f.homeAirportId)?.isVpn;

  return (
    <div className="w-[300px] rounded-lg border border-zinc-800 bg-black/85 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-300">
          {title}
        </span>
        <span className="font-mono text-[10px] text-zinc-600">{rows.length}</span>
      </div>
      <div className="hud-scroll max-h-[168px] overflow-y-auto py-1">
        {rows.length === 0 && (
          <div className="px-3 py-3 text-center font-mono text-[10px] text-zinc-600">
            no {direction} flights
          </div>
        )}
        {rows.map((f) => (
          <button
            key={f.id}
            onClick={() => select(f.id)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1 text-left font-mono text-[11px] hover:bg-zinc-900/70',
              selectedId === f.id && 'bg-zinc-900',
            )}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.liveryColor }} />
            <span className="w-[66px] shrink-0 text-zinc-300">{f.id}</span>
            <span className="flex-1 truncate text-zinc-400">{f.hostname}</span>
            <span className="shrink-0">{f.countryFlag}</span>
            <span className={cn('w-[54px] shrink-0 text-right', PHASE_STYLE[f.phase])}>
              {f.phase.toUpperCase()}
            </span>
            {isVpn(f) && (
              <span className="shrink-0 rounded bg-violet-900/60 px-1 text-[9px] text-violet-300">
                VPN
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
