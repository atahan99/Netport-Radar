import { useFiltersStore, type BooleanFilterKey, type FilterState } from '@/store/filters';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { filterChips } from '@/lib/filter-chips';
import { cn } from '@/lib/utils';
import { Search, X, RotateCcw } from 'lucide-react';

const PROTOCOL_TOGGLES: [BooleanFilterKey, string][] = [
  ['showHTTPS', 'HTTPS'],
  ['showHTTP', 'HTTP'],
  ['showVPN', 'VPN'],
  ['showDNS', 'DNS'],
  ['showQUIC', 'QUIC'],
  ['showUDP', 'UDP'],
  ['showICMP', 'ICMP'],
  ['showSSH', 'SSH/Tor'],
  ['showStreaming', 'Streaming'],
  ['showGaming', 'Gaming'],
];

const TRAFFIC_TOGGLES: [BooleanFilterKey, string][] = [
  ['showLAN', 'LAN'],
  ['showIPv6', 'IPv6'],
];

const DNS_OPTS: [FilterState['dnsDensity'], string][] = [
  ['sample', 'Sample 1:10'],
  ['all', 'Show all'],
  ['none', 'Hide'],
];
const DIR_OPTS: [FilterState['direction'], string][] = [
  ['both', 'Both'],
  ['outbound', 'Outbound'],
  ['inbound', 'Inbound'],
];
const AIRPORT_OPTS: [FilterState['airportFilter'], string][] = [
  ['all', 'All'],
  ['primary', 'Primary'],
  ['vpn', 'VPN'],
];
const TRAIL_OPTS: [FilterState['trailStyle'], string][] = [
  ['livery', 'App colors'],
  ['altitude', 'Altitude'],
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </div>
  );
}

// Toggle chip. Shown: solid pill with an accent dot. Hidden: dashed, struck
// through and dimmed, so the two states differ in more than shade.
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
          : 'border-dashed border-zinc-700 bg-transparent text-zinc-500 line-through hover:border-zinc-500 hover:text-zinc-300',
      )}
    >
      {active && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--theme-accent, #4285f4)' }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

// Segmented control for the small single-choice groups.
function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[11px] transition-colors',
            value === v ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function FilterPanel() {
  const s = useFiltersStore();
  const activeCount = filterChips(s).length;

  return (
    <Sheet
      open={s.filterDrawerOpen}
      onOpenChange={(open) => {
        if (open !== s.filterDrawerOpen) s.toggleFilterDrawer();
      }}
    >
      <SheetContent side="right">
        <SheetHeader className="border-b border-zinc-800">
          <SheetTitle className="flex items-center gap-2">
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                {activeCount} active
              </span>
            )}
          </SheetTitle>
          <SheetDescription>Affects rendering only — the log keeps everything.</SheetDescription>
        </SheetHeader>

        <div className="hud-scroll h-[calc(100%-64px)] space-y-5 overflow-y-auto p-4">
          <div>
            <SectionLabel>Protocols</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {PROTOCOL_TOGGLES.map(([key, label]) => (
                <Chip key={key} active={s[key]} onClick={() => s.toggle(key)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Traffic</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {TRAFFIC_TOGGLES.map(([key, label]) => (
                <Chip key={key} active={s[key]} onClick={() => s.toggle(key)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>DNS density</SectionLabel>
            <Segmented ariaLabel="DNS density" value={s.dnsDensity} onChange={s.setDnsDensity} options={DNS_OPTS} />
          </div>

          <div>
            <SectionLabel>Direction</SectionLabel>
            <Segmented ariaLabel="Direction" value={s.direction} onChange={s.setDirection} options={DIR_OPTS} />
          </div>

          <div>
            <SectionLabel>App search</SectionLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={s.appSearch}
                onChange={(e) => s.setAppSearch(e.target.value)}
                placeholder="process name…"
                aria-label="Filter by process name"
                className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 pl-7 pr-7 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-ring"
              />
              {s.appSearch && (
                <button
                  onClick={() => s.setAppSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <SectionLabel>Country</SectionLabel>
            {s.isolatedCountry ? (
              <button
                onClick={() => s.setIsolatedCountry(null)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {s.isolatedCountry} <X className="h-3 w-3" /> clear
              </button>
            ) : (
              <div className="text-xs text-zinc-500">Click a destination dot to isolate.</div>
            )}
          </div>

          <div>
            <SectionLabel>Home airport</SectionLabel>
            <Segmented ariaLabel="Home airport" value={s.airportFilter} onChange={s.setAirportFilter} options={AIRPORT_OPTS} />
          </div>

          <div>
            <SectionLabel>Trail colors</SectionLabel>
            <Segmented ariaLabel="Trail colors" value={s.trailStyle} onChange={s.setTrailStyle} options={TRAIL_OPTS} />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={activeCount === 0}
            onClick={() => s.reset()}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset all{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
