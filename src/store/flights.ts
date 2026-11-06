import { create } from 'zustand';
import type { Flight, HomeAirport } from '@/types';

interface FlightsStore {
  flights: Flight[]; // current flights (landed ones are pruned after a linger)
  homeAirports: HomeAirport[];
  selectedFlightId: string | null;
  setFlights: (flights: Flight[]) => void;
  setHomeAirports: (airports: HomeAirport[]) => void;
  selectFlight: (id: string | null) => void;
}

export const useFlightsStore = create<FlightsStore>((set) => ({
  flights: [],
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
}));
