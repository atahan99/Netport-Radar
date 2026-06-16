import { create } from 'zustand';
import { TOAST_TTL_MS } from '@/config';

// Lightweight non-blocking notifications (interface down, transient capture
// errors). Fatal startup problems use the blocking StartupOverlay instead.
export type ToastKind = 'info' | 'warn' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastStore {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, kind = 'info', ttlMs = TOAST_TTL_MS) => {
    let id = 0;
    set((s) => {
      // De-dupe: a repeating capture error shouldn't stack a wall of toasts.
      if (s.toasts.some((t) => t.message === message)) return s;
      id = nextId++;
      return { toasts: [...s.toasts, { id, message, kind }] };
    });
    if (id) {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
