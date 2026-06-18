// src/lib/filter-chips.ts
// Derive the set of active (non-default) filter chips. Kept out of the
// component file so both FilterChips and MetricsStrip can import it.

import type { FilterState, FilterDataKey } from '@/store/filters';

export interface FilterChip {
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

export function filterChips(f: FilterState): FilterChip[] {
  const chips: FilterChip[] = [];
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
