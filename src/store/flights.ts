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

  setFlights: (flights) => set({ flights }),
  setHomeAirports: (homeAirports) => set({ homeAirports }),
  selectFlight: (selectedFlightId) => set({ selectedFlightId }),
}));
