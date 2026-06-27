import { useFiltersStore, type BooleanFilterKey } from '@/store/filters';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </div>
  );
}

function RadioRow({ value, label }: { value: string; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
      <RadioGroupItem value={value} />
      {label}
    </label>
  );
}

export default function FilterPanel() {
  const s = useFiltersStore();

  return (
    <Sheet
      open={s.filterDrawerOpen}
      onOpenChange={(open) => {
        if (open !== s.filterDrawerOpen) s.toggleFilterDrawer();
      }}
    >
      <SheetContent side="right">
        <SheetHeader className="border-b border-zinc-800">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Affects rendering only — the log keeps everything.</SheetDescription>
        </SheetHeader>

        <div className="hud-scroll h-[calc(100%-64px)] space-y-5 overflow-y-auto p-4">
          <div>
            <SectionLabel>Protocols</SectionLabel>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {PROTOCOL_TOGGLES.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300">{label}</span>
                  <Switch checked={s[key]} onCheckedChange={() => s.toggle(key)} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Traffic</SectionLabel>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {TRAFFIC_TOGGLES.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300">{label}</span>
                  <Switch checked={s[key]} onCheckedChange={() => s.toggle(key)} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>DNS density</SectionLabel>
            <RadioGroup value={s.dnsDensity} onValueChange={(v) => s.setDnsDensity(v as typeof s.dnsDensity)}>
              <RadioRow value="sample" label="Sample (1:10)" />
              <RadioRow value="all" label="Show all" />
              <RadioRow value="none" label="Hide all" />
            </RadioGroup>
          </div>

          <div>
            <SectionLabel>Direction</SectionLabel>
            <RadioGroup value={s.direction} onValueChange={(v) => s.setDirection(v as typeof s.direction)}>
              <RadioRow value="both" label="Both" />
              <RadioRow value="outbound" label="Outbound" />
              <RadioRow value="inbound" label="Inbound" />
            </RadioGroup>
          </div>

          <div>
            <SectionLabel>App search</SectionLabel>
            <input
              value={s.appSearch}
              onChange={(e) => s.setAppSearch(e.target.value)}
              placeholder="process name…"
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <SectionLabel>Country</SectionLabel>
            {s.isolatedCountry ? (
              <button
                onClick={() => s.setIsolatedCountry(null)}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {s.isolatedCountry} <X className="h-3 w-3" /> clear
              </button>
            ) : (
              <div className="text-xs text-zinc-600">Click a destination dot to isolate.</div>
            )}
          </div>

          <div>
            <SectionLabel>Home airport</SectionLabel>
            <RadioGroup value={s.airportFilter} onValueChange={(v) => s.setAirportFilter(v as typeof s.airportFilter)}>
              <RadioRow value="all" label="All" />
              <RadioRow value="primary" label="Primary only" />
              <RadioRow value="vpn" label="VPN only" />
            </RadioGroup>
          </div>

          <Button variant="outline" size="sm" className="w-full" onClick={() => s.reset()}>
            Reset all
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
