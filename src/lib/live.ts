// src/lib/live.ts
// useLiveFlights() — WebSocket client for the capture backend.
// Server owns phase + metrics; the client animates arcProgress (visual) from
// the phase + elapsed time, mirroring the demo's rAF loop.

import { useEffect } from 'react';
import type { ClientMessage } from '@/types';
import { useFlightsStore } from '@/store/flights';
import { useConnectionStore } from '@/store/connection';
import { useBackendStore, FATAL_CODES } from '@/store/backend';
import { useToastStore } from '@/store/toasts';
import { useDiagnosticsStore } from '@/store/diagnostics';
import { arcProgressLive, STORE_PUSH_MS } from '@/lib/anim';
import { CRUISE_MS, CRUISE_TARGET, DESCENT_MS, LANDED_TTL_MS } from '@/config';
import { LiveState, parseServerMessage, type LiveFlight } from '@/lib/live-state';

// Control handle — live while the socket is open so the UI (MetricsStrip) can
// request an interface switch / log export.
export const liveControl: { send: (m: ClientMessage) => void } = { send: () => {} };

// Reconnect-now handle for the ReconnectingOverlay's "Try now" button.
export const liveReconnect: { now: () => void } = { now: () => {} };

function downloadNdjson(ndjson: string): void {
  const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `netport-radar-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
}

export function useLiveFlights(enabled: boolean): void {
  const setFlights = useFlightsStore((s) => s.setFlights);
  const setHomeAirports = useFlightsStore((s) => s.setHomeAirports);

  useEffect(() => {
    if (!enabled) return;

    const state = new LiveState();
    const flights = state.flights;
    const conn = useConnectionStore.getState();
    const backend = useBackendStore.getState();
    let ws: WebSocket | null = null;
    let raf = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastPrune = 0;
    let lastPush = 0;
    let pushPending = false; // force an immediate store push (membership/phase change)
    let closed = false;

    const resetFlights = () => {
      state.clear();
      arcProgressLive.clear();
      useFlightsStore.getState().selectFlight(null);
      pushPending = true;
    };

    const animate = (lf: LiveFlight, now: number) => {
      const dt = now - lf.phaseStartedAt;
      if (lf.phase === 'taxi') lf.arcProgress = 0;
      else if (lf.phase === 'cruise')
        lf.arcProgress = Math.min(CRUISE_TARGET, lf.cruiseBase + (dt / CRUISE_MS) * CRUISE_TARGET);
      else if (lf.phase === 'descent')
        lf.arcProgress = Math.min(1, lf.cruiseBase + (dt / DESCENT_MS) * (1 - lf.cruiseBase));
      else if (lf.phase === 'landed') lf.arcProgress = 1;
      // hold: keep current arcProgress
    };

    const loop = (now: number) => {
      // Reschedule first-class: one bad frame must not stop the animation for good.
      try {
        // Per-frame: animate arcProgress into the animation channel (the views
        // read this every frame for smooth motion). The store is pushed at 10Hz.
        for (const lf of flights) {
          animate(lf, now);
          arcProgressLive.set(lf.id, lf.arcProgress);
        }
        if (now - lastPrune > 2000) {
          lastPrune = now;
          for (let i = flights.length - 1; i >= 0; i--) {
            const lf = flights[i];
            if (lf.phase === 'landed' && now - lf.phaseStartedAt > LANDED_TTL_MS) {
              arcProgressLive.delete(state.remove(i).id);
              pushPending = true; // membership change
            }
          }
        }
        if (pushPending || now - lastPush >= STORE_PUSH_MS) {
          pushPending = false;
          lastPush = now;
          setFlights(flights.slice());
        }
      } finally {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);

    const connect = () => {
      conn.bumpAttempt(); // count each real attempt (drives the overlay's counter)
      useDiagnosticsStore.getState().setWsState('connecting');
      // Token only present when the server is bound beyond loopback (it rides
      // the page URL from the server's printed link).
      const token = new URLSearchParams(location.search).get('token');
      const sock = new WebSocket(
        `ws://${location.hostname}:8090${token ? `/?token=${encodeURIComponent(token)}` : ''}`,
      );
      ws = sock;
      // Every handler checks it still belongs to the current socket: a socket
      // replaced by "Try now" must not flip state, clobber liveControl, or
      // schedule another reconnect.
      const current = () => ws === sock;
      sock.onopen = () => {
        if (!current()) return;
        conn.setReconnecting(false);
        backend.setOnline(true);
        useDiagnosticsStore.getState().setWsState('connected');
        liveControl.send = (m) => sock.send(JSON.stringify(m));
      };
      sock.onmessage = (ev) => {
        if (!current()) return;
        const msg = parseServerMessage(ev.data);
        if (!msg) return;
        const now = performance.now();
        if (msg.type === 'init') {
          // Authoritative snapshot: drop whatever we had (stale after an outage,
          // or colliding ids after a server restart) and start from the server's.
          resetFlights();
          state.seed(msg.flights, now);
          setHomeAirports(msg.homeAirports);
          backend.setBackend(msg.backend);
          backend.setError(null);
        } else if (msg.type === 'home_update') {
          setHomeAirports(msg.homeAirports);
        } else if (msg.type === 'batch') {
          for (const e of msg.events) if (state.apply(e, now)) pushPending = true;
        } else if (msg.type === 'reset') {
          resetFlights();
        } else if (msg.type === 'log') {
          downloadNdjson(msg.ndjson);
        } else if (msg.type === 'error') {
          // Fatal (blocking overlay) + sticky banner codes hold the error field;
          // transient capture hiccups surface as a self-dismissing toast.
          if (
            FATAL_CODES.has(msg.code) ||
            msg.code === 'capture_permission' ||
            msg.code === 'capture_dead'
          ) {
            backend.setError({ code: msg.code, message: msg.message });
          } else {
            useToastStore.getState().push(msg.message, 'warn');
          }
        }
      };
      sock.onerror = () => {
        if (!current()) return;
        useDiagnosticsStore.getState().recordWsError('WebSocket connection error');
        useToastStore.getState().push('WebSocket connection error — retrying…', 'warn');
        sock.close();
      };
      sock.onclose = (ev) => {
        if (!current()) return;
        backend.setOnline(false);
        liveControl.send = () => {};
        useDiagnosticsStore.getState().recordWsClose(ev.code, ev.reason);
        if (!closed && ev.code !== 1000) {
          useToastStore.getState().push(
            `WebSocket disconnected (code ${ev.code}) — retrying…`,
            'warn',
          );
        }
        if (closed) return;
        conn.setReconnecting(true);
        clearTimeout(retry);
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    // "Try now" in the reconnecting overlay: skip the 3s backoff and retry now.
    liveReconnect.now = () => {
      if (closed) return;
      clearTimeout(retry);
      const old = ws;
      ws = null; // detach first so the old socket's late onclose is ignored
      old?.close();
      connect();
    };

    return () => {
      closed = true;
      liveControl.send = () => {};
      liveReconnect.now = () => {};
      cancelAnimationFrame(raf);
      clearTimeout(retry);
      const old = ws;
      ws = null;
      old?.close();
      arcProgressLive.clear();
    };
  }, [enabled, setFlights, setHomeAirports]);
}
