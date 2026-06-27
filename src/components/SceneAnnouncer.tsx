import { useMemo } from 'react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { PROTOCOL_LABELS } from '@/lib/classify';
import { PHASE_META } from '@/lib/phase';
import type { Flight } from '@/types';

// The map/globe is a <canvas> — invisible to assistive tech. This component gives
// screen-reader users (a) a static description of what the app is and how to browse
// it with a keyboard, and (b) a polite live region that announces the selected
// flight. We deliberately do NOT announce the constant flight churn (it would spam
// the SR) — only the user's own selection changes.

function describe(f: Flight): string {
  const dest = f.hostname || f.dstIp;
  const dir = f.direction === 'inbound' ? 'from' : 'to';
  const where = [f.city, f.country].filter(Boolean).join(', ');
  return `Selected ${f.id}, ${PROTOCOL_LABELS[f.detectedProtocol]} ${dir} ${dest}${
    where ? ` in ${where}` : ''
  }. ${PHASE_META[f.phase].label.toLowerCase()}.`;
}

export default function SceneAnnouncer() {
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const viewMode = useFiltersStore((s) => s.viewMode);

  // Snapshot the description when the selection changes (not on every store push),
  // so the live region announces a flight once when the user picks it.
  const msg = useMemo(() => {
    if (!selectedId) return '';
    const f = useFlightsStore.getState().flights.find((x) => x.id === selectedId);
    return f ? describe(f) : '';
  }, [selectedId]);

  return (
    <>
      <h1 className="sr-only">Netport Radar — live network connection map</h1>
      <p className="sr-only">
        Your computer&apos;s live network connections are shown as aircraft on a{' '}
        {viewMode === '2d' ? '2D map' : '3D globe'}. The visualization is graphical; to browse and
        select connections with a keyboard or screen reader, use the Departures and Arrivals lists
        (arrow keys move between rows, Enter selects), or open Filters from the top-right toolbar.
        Press Escape to clear a selection.
      </p>
      <div aria-live="polite" role="status" className="sr-only">
        {msg}
      </div>
    </>
  );
}
