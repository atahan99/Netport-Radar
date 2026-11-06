import { create } from 'zustand';

// Connection / reconnect-overlay state. In demo mode the R key toggles it.
interface ConnectionStore {
  reconnecting: boolean;
  attempt: number;
  setReconnecting: (v: boolean) => void;
  bumpAttempt: () => void;
  connected: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  reconnecting: false,
  attempt: 0, // connection attempts since the last successful connect
  setReconnecting: (reconnecting) => set({ reconnecting }),
  bumpAttempt: () => set((s) => ({ attempt: s.attempt + 1 })),
  connected: () => set({ reconnecting: false, attempt: 0 }),
}));
