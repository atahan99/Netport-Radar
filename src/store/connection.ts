import { create } from 'zustand';

// Connection / reconnect-overlay state. In demo mode the R key toggles it.
interface ConnectionStore {
  reconnecting: boolean;
  attempt: number;
  setReconnecting: (v: boolean) => void;
  bumpAttempt: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  reconnecting: false,
  attempt: 1,
  setReconnecting: (reconnecting) => set({ reconnecting, attempt: 1 }),
  bumpAttempt: () => set((s) => ({ attempt: s.attempt + 1 })),
}));
