import { X } from 'lucide-react';
import { useFiltersStore, type FilterState, type FilterDataKey } from '@/store/filters';

interface Chip {
  key: FilterDataKey;
  label: string;
}

const PROTO_LABELS: Partial<Record<FilterDataKey, string>> = {
  showHTTPS: 'HTTPS',
  showHTTP: 'HTTP',
  showVPN: 'VPN',
  showDNS: 'DNS',
  showQUIC: 'QUIC',
  showUDP: 'UDP',
  showICMP: 'ICMP',
  showSSH: 'SSH/Tor',
  showStreaming: 'Streaming',
  showGaming: 'Gaming',
  showLAN: 'LAN',
  showIPv6: 'IPv6',
};

// Derive a chip per non-default filter. Shared with MetricsStrip (amber dot).
export function filterChips(f: FilterState): Chip[] {
  const chips: Chip[] = [];
  for (const [key, label] of Object.entries(PROTO_LABELS) as [FilterDataKey, string][]) {
    if (!f[key as keyof FilterState]) chips.push({ key, label: `${label} off` });
  }
  if (f.dnsDensity !== 'sample') chips.push({ key: 'dnsDensity', label: `DNS: ${f.dnsDensity}` });
  if (f.direction !== 'both') chips.push({ key: 'direction', label: `${f.direction} only` });
  if (f.appSearch) chips.push({ key: 'appSearch', label: `Search: "${f.appSearch}"` });
  if (f.isolatedCountry) chips.push({ key: 'isolatedCountry', label: `Country: ${f.isolatedCountry}` });
  if (f.airportFilter !== 'all') chips.push({ key: 'airportFilter', label: `Home: ${f.airportFilter}` });
  return chips;
}

export default function FilterChips() {
  const filters = useFiltersStore();
  const resetKey = useFiltersStore((s) => s.resetKey);
  const chips = filterChips(filters);
  if (chips.length === 0) return null;
  return (
    <div className="flex max-w-[340px] flex-wrap justify-end gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={() => resetKey(c.key)}
          className="flex items-center gap-1 rounded-full border border-amber-700/50 bg-amber-950/70 px-2 py-0.5 text-[10px] text-amber-200 backdrop-blur-sm transition-colors hover:bg-amber-900/70"
          title={`Clear filter: ${c.label}`}
        >
          {c.label}
          <X className="h-2.5 w-2.5" />
        </button>
      ))}
    </div>
  );
}
