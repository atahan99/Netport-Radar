import { useMemo } from 'react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { getRenderQueue } from '@/lib/render-queue';

// Recomputes the render queue whenever the flight set (each frame) or any
// filter changes. Used by MetricsStrip; the map/globe views compute their
// own queue imperatively to avoid per-frame React reconciliation.
export function useRenderQueue() {
  const flights = useFlightsStore((s) => s.flights);
  const filters = useFiltersStore();
  return useMemo(() => getRenderQueue(flights, filters), [flights, filters]);
}
