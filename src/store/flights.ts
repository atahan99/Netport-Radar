import { create } from 'zustand';
import type { Flight, HomeAirport } from '@/types';

interface FlightsStore {
  flights: Flight[]; // ALL flights, never evicted during session
  homeAirports: HomeAirport[];
  selectedFlightId: string | null;
  offScreenCount: number; // flights beyond the render cap
  setFlights: (flights: Flight[]) => void;
  upsertFlight: (flight: Flight) => void;
  patchFlight: (id: string, patch: Partial<Flight>) => void;
  setHomeAirports: (airports: HomeAirport[]) => void;
  selectFlight: (id: string | null) => void;
  setOffScreenCount: (n: number) => void;
  reset: () => void;
}

export const useFlightsStore = create<FlightsStore>((set) => ({
  flights: [],
  homeAirports: [],
  selectedFlightId: null,
  offScreenCount: 0,

  setFlights: (flights) => set({ flights }),

  upsertFlight: (flight) =>
    set((s) => {
      const i = s.flights.findIndex((f) => f.id === flight.id);
      if (i === -1) return { flights: [...s.flights, flight] };
      const next = s.flights.slice();
      next[i] = flight;
      return { flights: next };
    }),

  patchFlight: (id, patch) =>
    set((s) => {
      const i = s.flights.findIndex((f) => f.id === id);
      if (i === -1) return {};
      const next = s.flights.slice();
      next[i] = { ...next[i], ...patch };
      return { flights: next };
    }),

  setHomeAirports: (homeAirports) => set({ homeAirports }),
  selectFlight: (selectedFlightId) => set({ selectedFlightId }),
  setOffScreenCount: (offScreenCount) => set({ offScreenCount }),
  reset: () => set({ flights: [], selectedFlightId: null, offScreenCount: 0 }),
}));
