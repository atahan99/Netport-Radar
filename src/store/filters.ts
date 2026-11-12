import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemeName } from '@/lib/themes';
import type { TrailStyle } from '@/lib/trail-color';

export type DnsDensity = 'sample' | 'all' | 'none';
export type Direction = 'both' | 'outbound' | 'inbound';
export type AirportFilter = 'all' | 'primary' | 'vpn';
export type ViewMode = '2d' | '3d';
export type CardAnchorMode = 'anchored' | 'docked';
export type BoardTab = 'outbound' | 'inbound' | 'log';

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
  theme: ThemeName;
  trailStyle: TrailStyle; // livery colors vs FR24 altitude rainbow
  filterDrawerOpen: boolean;
  legendOpen: boolean;
  aboutOpen: boolean;
  // Flight-card position — per view so each can default differently
  cardAnchor2d: CardAnchorMode; // default 'docked'
  cardAnchor3d: CardAnchorMode; // default 'docked'
  boardTab: BoardTab; // which list the bottom board shows (not reset by "Reset all")
  // Actions
  toggle: (key: BooleanFilterKey) => void;
  setDnsDensity: (d: DnsDensity) => void;
  setDirection: (d: Direction) => void;
  setAppSearch: (s: string) => void;
  setIsolatedCountry: (c: string | null) => void;
  setAirportFilter: (f: AirportFilter) => void;
  setViewMode: (m: ViewMode) => void;
  setTheme: (t: ThemeName) => void;
  setTrailStyle: (t: TrailStyle) => void;
  toggleCardAnchor: () => void; // flips the mode for the active viewMode
  toggleFilterDrawer: () => void;
  setLegend: (open: boolean) => void;
  toggleLegend: () => void;
  setAbout: (open: boolean) => void;
  toggleAbout: () => void;
  setBoardTab: (t: BoardTab) => void;
  resetKey: (key: FilterDataKey) => void; // reset one filter to its default
  reset: () => void;
}

// Filter data keys (no view/card state) — resettable individually via the chips.
export type FilterDataKey =
  | BooleanFilterKey
  | 'dnsDensity'
  | 'direction'
  | 'appSearch'
  | 'isolatedCountry'
  | 'airportFilter';

// Just the fields that decide which flights render. Components that only need
// these subscribe via useShallow(selectFilterData) so drawer/legend/theme
// toggles don't re-render them.
export type FilterData = Pick<FilterState, FilterDataKey>;
export const FILTER_DATA_KEYS: readonly FilterDataKey[] = [
  'showHTTPS',
  'showHTTP',
  'showVPN',
  'showDNS',
  'showQUIC',
  'showUDP',
  'showICMP',
  'showSSH',
  'showStreaming',
  'showGaming',
  'showLAN',
  'showIPv6',
  'dnsDensity',
  'direction',
  'appSearch',
  'isolatedCountry',
  'airportFilter',
];
export function selectFilterData(s: FilterData): FilterData {
  const out = {} as Record<FilterDataKey, unknown>;
  for (const k of FILTER_DATA_KEYS) out[k] = s[k];
  return out as FilterData;
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
  theme: 'midnight' as ThemeName,
  trailStyle: 'livery' as TrailStyle,
  cardAnchor2d: 'docked' as CardAnchorMode,
  cardAnchor3d: 'docked' as CardAnchorMode,
};

export const useFiltersStore = create<FilterState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      filterDrawerOpen: false,
      legendOpen: false,
      aboutOpen: false,
      boardTab: 'outbound',

      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<FilterState>),
      setDnsDensity: (dnsDensity) => set({ dnsDensity }),
      setDirection: (direction) => set({ direction }),
      setAppSearch: (appSearch) => set({ appSearch }),
      setIsolatedCountry: (isolatedCountry) => set({ isolatedCountry }),
      setAirportFilter: (airportFilter) => set({ airportFilter }),
      setViewMode: (viewMode) => set({ viewMode }),
      setTheme: (theme) => set({ theme }),
      setTrailStyle: (trailStyle) => set({ trailStyle }),
      toggleCardAnchor: () =>
        set((s) =>
          s.viewMode === '2d'
            ? { cardAnchor2d: s.cardAnchor2d === 'anchored' ? 'docked' : 'anchored' }
            : { cardAnchor3d: s.cardAnchor3d === 'anchored' ? 'docked' : 'anchored' },
        ),
      toggleFilterDrawer: () => set((s) => ({ filterDrawerOpen: !s.filterDrawerOpen })),
      setLegend: (legendOpen) => set({ legendOpen }),
      // Legend and About share the same spot under the toolbar: one at a time.
      toggleLegend: () => set((s) => ({ legendOpen: !s.legendOpen, aboutOpen: false })),
      setAbout: (aboutOpen) => set({ aboutOpen }),
      toggleAbout: () => set((s) => ({ aboutOpen: !s.aboutOpen, legendOpen: false })),
      setBoardTab: (boardTab) => set({ boardTab }),
      resetKey: (key) => set({ [key]: DEFAULTS[key] } as Partial<FilterState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'netport-filters',
      storage: createJSONStorage(() => sessionStorage),
      // Persist preferences only — NOT the transient drawer state, and NOT
      // appSearch/isolatedCountry: a fresh tab should never start with
      // hidden traffic the user can't see they enabled last session.
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
        airportFilter: s.airportFilter,
        viewMode: s.viewMode,
        theme: s.theme,
        trailStyle: s.trailStyle,
        cardAnchor2d: s.cardAnchor2d,
        cardAnchor3d: s.cardAnchor3d,
        boardTab: s.boardTab,
      }),
    },
  ),
);
