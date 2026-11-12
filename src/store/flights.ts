import { create } from 'zustand';
import type { Flight, HomeAirport } from '@/types';

interface FlightsStore {
  flights: Flight[]; // current flights (landed ones are pruned after a linger)
  retired: Flight[]; // pruned flights, kept so session stats stay cumulative
  homeAirports: HomeAirport[];
  selectedFlightId: string | null;
  setFlights: (flights: Flight[]) => void;
  setHomeAirports: (airports: HomeAirport[]) => void;
  selectFlight: (id: string | null) => void;
  retire: (gone: Flight[]) => void;
}

// shortcut: whole flights capped at 5000, upgrade to running per-key tallies if sessions outgrow it
export const RETIRED_CAP = 5000;

export const useFlightsStore = create<FlightsStore>((set) => ({
  flights: [],
  retired: [],
  homeAirports: [],
  selectedFlightId: null,

  // A pruned or reset flight can't stay selected (it would keep auto-rotate off
  // and swallow Esc), so drop a selection whose flight is gone.
  setFlights: (flights) =>
    set((s) =>
      s.selectedFlightId && !flights.some((f) => f.id === s.selectedFlightId)
        ? { flights, selectedFlightId: null }
        : { flights },
    ),
  setHomeAirports: (homeAirports) => set({ homeAirports }),
  selectFlight: (selectedFlightId) => set({ selectedFlightId }),
  retire: (gone) => {
    if (gone.length) set((s) => ({ retired: [...s.retired, ...gone].slice(-RETIRED_CAP) }));
  },
}));
