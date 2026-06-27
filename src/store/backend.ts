import { create } from 'zustand';
import type { BackendInfo } from '@/types';

// Error codes that block all capture — the frontend shows a full-screen
// StartupOverlay for these. Other codes are non-blocking (banner / toast).
export const FATAL_CODES = new Set(['no_backend', 'port_in_use']);

// Live backend info (capture method / DPI mode / interface) for the metrics strip.
interface BackendStore {
  backend: BackendInfo | null;
  online: boolean;
  error: { code: string; message: string } | null;
  setBackend: (b: BackendInfo) => void;
  setOnline: (v: boolean) => void;
  setError: (e: { code: string; message: string } | null) => void;
}

export const useBackendStore = create<BackendStore>((set) => ({
  backend: null,
  online: false,
  error: null,
  setBackend: (backend) => set({ backend }),
  setOnline: (online) => set({ online }),
  setError: (error) => set({ error }),
}));
