// src/lib/live.ts
// useLiveFlights() — WebSocket client for the Phase 3 capture backend.
// Server owns phase + metrics; the client animates arcProgress (visual) from
// the phase + elapsed time, mirroring the demo's rAF loop.

import { useEffect } from 'react';
import type { ClientMessage, Flight, FlightEvent, ServerMessage } from '@/types';
import { useFlightsStore } from '@/store/flights';
import { useConnectionStore } from '@/store/connection';
import { useBackendStore, FATAL_CODES } from '@/store/backend';
import { useToastStore } from '@/store/toasts';

interface LiveFlight extends Flight {
  phaseStartedAt: number; // client clock (performance.now) when current phase began
  cruiseBase: number; // arcProgress when cruise/descent began (for resume)
}

const CRUISE_MS = 18000; // visual time to fly out to the cruise hold point
const CRUISE_TARGET = 0.8;
const LANDED_TTL_MS = 60_000;

// Control handle — live while the socket is open so the UI (MetricsStrip) can
// request an interface switch / log export.
export const liveControl: { send: (m: ClientMessage) => void } = { send: () => {} };

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

    const flights: LiveFlight[] = [];
    const byId = new Map<string, LiveFlight>();
    const conn = useConnectionStore.getState();
    const backend = useBackendStore.getState();
    let ws: WebSocket | null = null;
    let raf = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastPrune = 0;
    let closed = false;

    const applyEvent = (e: FlightEvent, now: number) => {
      if (e.event === 'opened') {
        const lf: LiveFlight = { ...e.flight, phaseStartedAt: now, cruiseBase: 0 };
        byId.set(lf.id, lf);
        flights.push(lf);
        return;
      }
      const lf = byId.get(e.id);
      if (!lf) return;
      if (e.event === 'updated') Object.assign(lf, e.patch);
      else if (e.event === 'hostname') {
        lf.hostname = e.hostname;
        if (e.sni) lf.sni = e.sni;
        lf.hostnameResolved = true;
      } else if (e.event === 'phase') {
        if (lf.phase !== e.phase) {
          lf.phaseStartedAt = now;
          lf.cruiseBase = lf.arcProgress;
        }
        lf.phase = e.phase;
      } else if (e.event === 'closed') {
        lf.bytesTotal = e.bytesTotal;
        lf.durationMs = e.durationMs;
        if (lf.phase !== 'landed') {
          lf.phase = 'landed';
          lf.phaseStartedAt = now;
        }
      }
    };

    const animate = (lf: LiveFlight, now: number) => {
      const dt = now - lf.phaseStartedAt;
      if (lf.phase === 'taxi') lf.arcProgress = 0;
      else if (lf.phase === 'cruise')
        lf.arcProgress = Math.min(CRUISE_TARGET, lf.cruiseBase + (dt / CRUISE_MS) * CRUISE_TARGET);
      else if (lf.phase === 'descent')
        lf.arcProgress = Math.min(1, lf.cruiseBase + (dt / 2000) * (1 - lf.cruiseBase));
      else if (lf.phase === 'landed') lf.arcProgress = 1;
      // hold: keep current arcProgress
    };

    const loop = (now: number) => {
      for (const lf of flights) animate(lf, now);
      if (now - lastPrune > 2000) {
        lastPrune = now;
        for (let i = flights.length - 1; i >= 0; i--) {
          const lf = flights[i];
          if (lf.phase === 'landed' && now - lf.phaseStartedAt > LANDED_TTL_MS) {
            byId.delete(lf.id);
            flights.splice(i, 1);
          }
        }
      }
      setFlights(flights.slice());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const connect = () => {
      // Token only present when the server is bound beyond loopback (it rides
      // the page URL from the server's printed link).
      const token = new URLSearchParams(location.search).get('token');
      ws = new WebSocket(`ws://${location.hostname}:8090${token ? `/?token=${token}` : ''}`);
      ws.onopen = () => {
        conn.setReconnecting(false);
        backend.setOnline(true);
        liveControl.send = (m) => ws?.send(JSON.stringify(m));
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        const now = performance.now();
        if (msg.type === 'init') {
          setHomeAirports(msg.homeAirports);
          backend.setBackend(msg.backend);
          backend.setError(null);
        } else if (msg.type === 'home_update') {
          setHomeAirports(msg.homeAirports);
        } else if (msg.type === 'batch') {
          for (const e of msg.events) applyEvent(e, now);
        } else if (msg.type === 'reset') {
          flights.length = 0;
          byId.clear();
          useFlightsStore.getState().selectFlight(null);
        } else if (msg.type === 'log') {
          downloadNdjson(msg.ndjson);
        } else if (msg.type === 'error') {
          // Fatal (blocking overlay) + sudo banner stay sticky in the error
          // field; transient capture hiccups surface as a self-dismissing toast.
          if (FATAL_CODES.has(msg.code) || msg.code === 'capture_permission') {
            backend.setError({ code: msg.code, message: msg.message });
          } else {
            useToastStore.getState().push(msg.message, 'warn');
          }
        }
      };
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        backend.setOnline(false);
        liveControl.send = () => {};
        if (closed) return;
        conn.setReconnecting(true);
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      liveControl.send = () => {};
      cancelAnimationFrame(raf);
      clearTimeout(retry);
      ws?.close();
    };
  }, [enabled, setFlights, setHomeAirports]);
}
