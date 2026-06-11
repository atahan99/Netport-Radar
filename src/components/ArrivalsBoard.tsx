import { Board } from './Board';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';

export default function ArrivalsBoard() {
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  // The docked flight card lives in this corner — yield to it while it's open.
  const dockedCardOpen = useFiltersStore(
    (s) => selectedId != null && (s.viewMode === '2d' ? s.cardAnchor2d : s.cardAnchor3d) === 'docked',
  );
  if (dockedCardOpen) return null;
  return <Board direction="inbound" title="ARRIVALS" />;
}
