import type { Flight } from '../src/types';
import type { FilterState } from '../src/store/filters';

let n = 0;
export function makeFlight(over: Partial<Flight> = {}): Flight {
  n++;
  return {
    id: `TST-${n.toString(16).toUpperCase().padStart(6, '0')}`,
    process: 'test',
    processRaw: 'test',
    pid: 1,
    protocol: 'TCP',
    detectedProtocol: 'HTTPS',
    port: 443,
    srcIp: '192.168.1.5',
    dstIp: '1.2.3.4',
    srcPort: 5000,
    dstPort: 443,
    isIPv6: false,
    homeAirportId: 'primary',
    dstLat: 0,
    dstLng: 0,
    country: 'US',
    countryFlag: '🇺🇸',
    city: 'X',
    org: 'Unknown',
    asn: '',
    hostname: 'x.com',
    sni: undefined,
    aircraftType: 'widebody',
    phase: 'cruise',
    liveryColor: '#ffffff',
    bytesTotal: 0,
    bytesTx: 0,
    bytesRx: 0,
    bytesPerSec: 0,
    packetsTotal: 0,
    durationMs: 0,
    arcProgress: 0.5,
    direction: 'outbound',
    isLan: false,
    startedAt: 0,
    hostnameResolved: true,
    ...over,
  };
}

// Render-queue/passesFilters only read the data fields, never the action fns —
// so a data-only object cast to FilterState is a faithful stand-in.
export function makeFilters(over: Partial<FilterState> = {}): FilterState {
  return {
    showHTTPS: true,
    showHTTP: true,
    showVPN: true,
    showDNS: true,
    showQUIC: true,
    showUDP: true,
    showICMP: true,
    showSSH: true,
    showStreaming: true,
    showGaming: true,
    showLAN: true,
    showIPv6: true,
    dnsDensity: 'all',
    direction: 'both',
    appSearch: '',
    isolatedCountry: null,
    airportFilter: 'all',
    viewMode: '2d',
    filterDrawerOpen: false,
    cardAnchor2d: 'anchored',
    cardAnchor3d: 'docked',
    ...over,
  } as FilterState;
}
