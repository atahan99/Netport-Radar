import { useEffect, useState } from 'react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore, type BoardTab } from '@/store/filters';
import { locateFlight } from '@/lib/locate';
import { PHASE_META } from '@/lib/phase';
import { cn } from '@/lib/utils';
import { geoFlagLabel } from '@/lib/geo-display';
import type { Flight } from '@/types';

const LANDED_LINGER_MS = 10_000;
const MAX_ROWS = 40;
const TABS: { id: BoardTab; label: string }[] = [
  { id: 'outbound', label: 'Departures' },
  { id: 'inbound', label: 'Arrivals' },
];

// Spoken label for a row — the visible content is terse mono, so spell it out.
function rowLabel(f: Flight, vpn: boolean): string {
  const dest = f.hostname || f.dstIp;
  const proc = f.process !== '—' ? `${f.process}, ` : '';
  return `${f.id}, ${proc}${dest}, ${f.country}, ${f.phase}${vpn ? ', via VPN' : ''}`;
}

// One board with Departures | Arrivals tabs (bottom-left). Both counts stay
// visible; the selected tab persists for the session.
export function Board() {
  const flights = useFlightsStore((s) => s.flights);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const select = useFlightsStore((s) => s.selectFlight);
  const tab = useFiltersStore((s) => s.boardTab);
  const setTab = useFiltersStore((s) => s.setBoardTab);

  // 1s tick drives the landed-row linger window (cheap; not per-frame).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = flights
    .filter((f) => f.phase !== 'landed' || (f.landedAt !== undefined && now - f.landedAt < LANDED_LINGER_MS))
    .sort((a, b) => b.startedAt - a.startedAt);
  const lists: Record<BoardTab, Flight[]> = {
    outbound: visible.filter((f) => f.direction === 'outbound').slice(0, MAX_ROWS),
    inbound: visible.filter((f) => f.direction === 'inbound').slice(0, MAX_ROWS),
  };
  const rows = lists[tab];
  const activeLabel = TABS.find((t) => t.id === tab)!.label;
  const homeOf = (f: Flight) => homeAirports.find((a) => a.id === f.homeAirportId);

  return (
    <div className="hud-panel w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-800 bg-black/85 backdrop-blur-sm max-[900px]:w-[300px]">
      <div role="tablist" aria-label="Flight boards" className="flex border-b border-zinc-800 px-1">
        {TABS.map((t, i) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              id={`board-tab-${t.id}`}
              aria-selected={selected}
              aria-controls="board-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
                setTab(next.id);
                document.getElementById(`board-tab-${next.id}`)?.focus();
              }}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider outline-none focus-visible:ring-1 focus-visible:ring-zinc-600',
                selected ? 'text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300',
              )}
              style={selected ? { borderColor: 'var(--theme-accent, #4285f4)' } : undefined}
            >
              {t.label}
              <span className="text-[10px] font-normal text-zinc-400">{lists[t.id].length}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="board-panel" aria-labelledby={`board-tab-${tab}`}>
        <div className="hud-scroll max-h-[196px] overflow-y-auto py-1" role="listbox" aria-label={activeLabel}>
          {rows.length === 0 && (
            <div className="px-3 py-3 text-center font-mono text-[10px] text-zinc-500">
              no {tab} flights
            </div>
          )}
          {rows.map((f) => {
            const home = homeOf(f);
            const landed = f.phase === 'landed';
            const geo = geoFlagLabel(f);
            return (
              <button
                key={f.id}
                role="option"
                aria-selected={selectedId === f.id}
                aria-label={rowLabel(f, !!home?.isVpn)}
                title={f.hostname || f.dstIp}
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
                <span className="shrink-0 font-mono text-[10px]">
                  {geo}
                  {/* A flag emoji alone is hard to read; ~CC / ?? already show the code. */}
                  {geo === f.countryFlag && <span className="ml-1 text-zinc-400">{f.country}</span>}
                </span>
                <span className={cn('w-[54px] shrink-0 text-right', PHASE_META[f.phase].textClass)}>
                  {f.phase.toUpperCase()}
                </span>
                {home?.isVpn && (
                  <span className="shrink-0 rounded bg-violet-900/60 px-1 text-[10px] text-violet-300">VPN</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
