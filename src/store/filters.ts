import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type DnsDensity = 'sample' | 'all' | 'none';
export type Direction = 'both' | 'outbound' | 'inbound';
export type AirportFilter = 'all' | 'primary' | 'vpn';
export type ViewMode = '2d' | '3d';
export type CardAnchorMode = 'anchored' | 'docked';

export type BooleanFilterKey =
  | 'showHTTPS'
  | 'showHTTP'
  | 'showVPN'
  | 'showDNS'
  | 'showQUIC'
  | 'showUDP'
  | 'showICMP'
  | 'showSSH'
  | 'showStreaming'
  | 'showGaming'
  | 'showLAN'
  | 'showIPv6';

export interface FilterState {
  // Protocol families — all true by default
  showHTTPS: boolean;
  showHTTP: boolean;
  showVPN: boolean;
  showDNS: boolean;
  showQUIC: boolean;
  showUDP: boolean;
  showICMP: boolean;
  showSSH: boolean;
  showStreaming: boolean;
  showGaming: boolean;
  // Traffic type
  showLAN: boolean;
  showIPv6: boolean;
  // DNS density
  dnsDensity: DnsDensity;
  // Direction
  direction: Direction;
  // App search
  appSearch: string;
  // Country isolation (set by clicking a destination dot)
  isolatedCountry: string | null;
  // Home airport
  airportFilter: AirportFilter;
  // View
  viewMode: ViewMode;
  filterDrawerOpen: boolean;
  // Flight-card position — per view so each can default differently
  cardAnchor2d: CardAnchorMode; // default 'anchored'
  cardAnchor3d: CardAnchorMode; // default 'docked'
  // Actions
  toggle: (key: BooleanFilterKey) => void;
  setDnsDensity: (d: DnsDensity) => void;
  setDirection: (d: Direction) => void;
  setAppSearch: (s: string) => void;
  setIsolatedCountry: (c: string | null) => void;
  setAirportFilter: (f: AirportFilter) => void;
  setViewMode: (m: ViewMode) => void;
  toggleCardAnchor: () => void; // flips the mode for the active viewMode
  toggleFilterDrawer: () => void;
  reset: () => void;
}

const DEFAULTS = {
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
  dnsDensity: 'sample' as DnsDensity,
  direction: 'both' as Direction,
  appSearch: '',
  isolatedCountry: null as string | null,
  airportFilter: 'all' as AirportFilter,
  viewMode: '2d' as ViewMode,
  cardAnchor2d: 'anchored' as CardAnchorMode,
  cardAnchor3d: 'docked' as CardAnchorMode,
};

export const useFiltersStore = create<FilterState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      filterDrawerOpen: false,

      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<FilterState>),
      setDnsDensity: (dnsDensity) => set({ dnsDensity }),
      setDirection: (direction) => set({ direction }),
      setAppSearch: (appSearch) => set({ appSearch }),
      setIsolatedCountry: (isolatedCountry) => set({ isolatedCountry }),
      setAirportFilter: (airportFilter) => set({ airportFilter }),
      setViewMode: (viewMode) => set({ viewMode }),
      toggleCardAnchor: () =>
        set((s) =>
          s.viewMode === '2d'
            ? { cardAnchor2d: s.cardAnchor2d === 'anchored' ? 'docked' : 'anchored' }
            : { cardAnchor3d: s.cardAnchor3d === 'anchored' ? 'docked' : 'anchored' },
        ),
      toggleFilterDrawer: () => set((s) => ({ filterDrawerOpen: !s.filterDrawerOpen })),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'netport-filters',
      storage: createJSONStorage(() => sessionStorage),
      // Persist preferences only — not the transient drawer-open state.
      partialize: (s) => ({
        showHTTPS: s.showHTTPS,
        showHTTP: s.showHTTP,
        showVPN: s.showVPN,
        showDNS: s.showDNS,
        showQUIC: s.showQUIC,
        showUDP: s.showUDP,
        showICMP: s.showICMP,
        showSSH: s.showSSH,
        showStreaming: s.showStreaming,
        showGaming: s.showGaming,
        showLAN: s.showLAN,
        showIPv6: s.showIPv6,
        dnsDensity: s.dnsDensity,
        direction: s.direction,
        appSearch: s.appSearch,
        isolatedCountry: s.isolatedCountry,
        airportFilter: s.airportFilter,
        viewMode: s.viewMode,
        cardAnchor2d: s.cardAnchor2d,
        cardAnchor3d: s.cardAnchor3d,
      }),
    },
  ),
);
