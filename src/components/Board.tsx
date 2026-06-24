import { useEffect, useState } from 'react';
import { useFlightsStore } from '@/store/flights';
import { locateFlight } from '@/lib/locate';
import { PHASE_META } from '@/lib/phase';
import { cn } from '@/lib/utils';
import type { Flight } from '@/types';

const LANDED_LINGER_MS = 10_000;

// Spoken label for a row — the visible content is terse mono, so spell it out.
function rowLabel(f: Flight, vpn: boolean): string {
  const dest = f.hostname || f.dstIp;
  const proc = f.process !== '—' ? `${f.process}, ` : '';
  return `${f.id}, ${proc}${dest}, ${f.country}, ${f.phase}${vpn ? ', via VPN' : ''}`;
}

export function Board({ direction, title }: { direction: 'outbound' | 'inbound'; title: string }) {
  const flights = useFlightsStore((s) => s.flights);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const select = useFlightsStore((s) => s.selectFlight);

  // 1s tick drives the landed-row linger window (cheap; not per-frame).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = flights
    .filter(
      (f) =>
        f.direction === direction &&
        (f.phase !== 'landed' || (f.landedAt !== undefined && now - f.landedAt < LANDED_LINGER_MS)),
    )
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 40);

  const homeOf = (f: Flight) => homeAirports.find((a) => a.id === f.homeAirportId);

  return (
    <div className="w-[300px] rounded-xl border border-zinc-800 bg-black/85 backdrop-blur-sm max-[900px]:w-[260px]">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-300">{title}</span>
        <span className="font-mono text-[10px] text-zinc-500">{rows.length}</span>
      </div>
      <div className="hud-scroll max-h-[168px] overflow-y-auto py-1" role="listbox" aria-label={title}>
        {rows.length === 0 && (
          <div className="px-3 py-3 text-center font-mono text-[10px] text-zinc-500">
            no {direction} flights
          </div>
        )}
        {rows.map((f) => {
          const home = homeOf(f);
          const landed = f.phase === 'landed';
          return (
            <button
              key={f.id}
              role="option"
              aria-selected={selectedId === f.id}
              aria-label={rowLabel(f, !!home?.isVpn)}
              onClick={() => {
                select(f.id);
                locateFlight(f, home);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                }
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] outline-none hover:bg-zinc-900/70 focus-visible:bg-zinc-900 focus-visible:ring-1 focus-visible:ring-zinc-600',
                selectedId === f.id && 'bg-zinc-900',
                landed && 'text-zinc-600 line-through opacity-70',
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.liveryColor }} />
              <span className="w-[66px] shrink-0 text-zinc-300">{f.id}</span>
              <span className="flex-1 truncate text-zinc-400">
                {f.process !== '—' && <span className="text-zinc-300">{f.process} · </span>}
                {f.hostname}
              </span>
              <span className="shrink-0">{f.countryFlag}</span>
              <span className={cn('w-[54px] shrink-0 text-right', PHASE_META[f.phase].textClass)}>
                {f.phase.toUpperCase()}
              </span>
              {home?.isVpn && (
                <span className="shrink-0 rounded bg-violet-900/60 px-1 text-[9px] text-violet-300">VPN</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
