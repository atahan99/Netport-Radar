import { create } from 'zustand'
import { downloadFile } from '@/lib/utils'

export interface DiagnosticEntry {
  at: number
  kind: 'ws' | 'chunk' | 'other'
  message: string
  detail?: string
}

interface DiagnosticsStore {
  entries: DiagnosticEntry[]
  wsState: 'connected' | 'disconnected' | 'connecting' | 'unknown'
  lastWsClose: { code: number; reason: string; at: number } | null
  chunkErrors: { component: string; message: string; at: number }[]
  recordWsClose: (code: number, reason: string) => void
  recordWsError: (message: string) => void
  setWsState: (state: DiagnosticsStore['wsState']) => void
  recordChunkError: (component: string, err: unknown) => void
  clear: () => void
  snapshot: () => Record<string, unknown>
}

export const useDiagnosticsStore = create<DiagnosticsStore>((set, get) => ({
  entries: [],
  wsState: 'unknown',
  lastWsClose: null,
  chunkErrors: [],

  recordWsClose: (code, reason) =>
    set((s) => {
      const message =
        code === 1000
          ? 'WebSocket closed normally'
          : `WebSocket closed (code ${code}${reason ? `: ${reason}` : ''})`
      const entry: DiagnosticEntry = {
        at: Date.now(),
        kind: 'ws',
        message,
        detail: `code=${code} reason=${reason || '(none)'}`,
      }
      return {
        wsState: 'disconnected',
        lastWsClose: { code, reason, at: Date.now() },
        entries: [...s.entries.slice(-19), entry],
      }
    }),

  recordWsError: (message) =>
    set((s) => ({
      entries: [
        ...s.entries.slice(-19),
        { at: Date.now(), kind: 'ws', message, detail: 'onerror' },
      ],
    })),

  setWsState: (wsState) => set({ wsState }),

  recordChunkError: (component, err) => {
    const message = err instanceof Error ? err.message : String(err)
    set((s) => ({
      chunkErrors: [...s.chunkErrors.slice(-9), { component, message, at: Date.now() }],
      entries: [
        ...s.entries.slice(-19),
        {
          at: Date.now(),
          kind: 'chunk',
          message: `Failed to load ${component}`,
          detail: message,
        },
      ],
    }))
  },

  clear: () =>
    set({
      entries: [],
      wsState: 'unknown',
      lastWsClose: null,
      chunkErrors: [],
    }),

  snapshot: () => {
    const s = get()
    return {
      exportedAt: new Date().toISOString(),
      wsState: s.wsState,
      lastWsClose: s.lastWsClose,
      chunkErrors: s.chunkErrors,
      entries: s.entries,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      location: typeof location !== 'undefined' ? location.href : '',
      demo: import.meta.env.VITE_DEMO === '1',
    }
  },
}))

export const exportDiagnostics = (): void => {
  const json = JSON.stringify(useDiagnosticsStore.getState().snapshot(), null, 2)
  downloadFile(json, 'application/json', 'json', 'diagnostics')
}
