import { useMemo } from 'react';
import { useFlightsStore } from '@/store/flights';
import { useShallow } from 'zustand/react/shallow';
import { useFiltersStore, selectFilterData } from '@/store/filters';
import { getRenderQueueMemo } from '@/lib/render-queue';

// Recomputes the render queue when the flight set (10Hz) or any filter changes.
// Used by MetricsStrip; the map/globe views call getRenderQueueMemo directly in
// their own loops, sharing the same single-entry memo.
export function useRenderQueue() {
  const flights = useFlightsStore((s) => s.flights);
  const filters = useFiltersStore(useShallow(selectFilterData));
  return useMemo(() => getRenderQueueMemo(flights, filters), [flights, filters]);
}
