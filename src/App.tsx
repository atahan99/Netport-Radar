import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { useDemoFlights } from '@/lib/demo';
import { useLiveFlights } from '@/lib/live';
import MapView from '@/components/MapView';
import FlightCard from '@/components/FlightCard';
import FilterPanel from '@/components/FilterPanel';
import DeparturesBoard from '@/components/DeparturesBoard';
import ArrivalsBoard from '@/components/ArrivalsBoard';
import RadarHUD from '@/components/RadarHUD';
import MetricsStrip from '@/components/MetricsStrip';
import ReconnectingOverlay from '@/components/ReconnectingOverlay';
import CaptureBanner from '@/components/CaptureBanner';
import StartupOverlay from '@/components/StartupOverlay';
import Toasts from '@/components/Toasts';
import ErrorBoundary from '@/components/ErrorBoundary';
import FilterChips from '@/components/FilterChips';
import Legend from '@/components/Legend';

// Code-split the 3D globe: it pulls in the ~3 MB three.js chunk, which the
// default 2D map + first paint shouldn't have to carry. Loaded on first switch.
const GlobeView = lazy(() => import('@/components/GlobeView'));

export default function App() {
  const viewMode = useFiltersStore((s) => s.viewMode);
  // Live capture by default; demo generator behind VITE_DEMO=1 for offline UI work.
  const demo = import.meta.env.VITE_DEMO === '1';
  useDemoFlights(demo);
  useLiveFlights(!demo);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Map / globe fills the screen; ErrorBoundary keeps a view crash (e.g. the
          lazy globe chunk) from white-screening the whole app. */}
      <ErrorBoundary>
        {viewMode === '2d' ? (
          <MapView />
        ) : (
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
              </div>
            }
          >
            <GlobeView />
          </Suspense>
        )}
      </ErrorBoundary>

      {/* Wordmark behind the HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-5 z-0 text-center text-sm font-semibold tracking-[0.35em] text-zinc-700">
        NETPORT·RADAR
      </div>

      {/* HUD overlays */}
      <div className="absolute left-4 top-4 z-10">
        <RadarHUD />
      </div>
      <div className="absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
        <MetricsStrip />
        <FilterChips />
      </div>
      <Legend />
      <div className="absolute bottom-4 left-4 z-10">
        <DeparturesBoard />
      </div>
      <div className="absolute bottom-4 right-4 z-10">
        <ArrivalsBoard />
      </div>

      {/* Flight card — anchored or docked per toggle; rendered at root */}
      <FlightCard />

      {/* Filter drawer (shadcn Sheet) */}
      <FilterPanel />

      {/* Capture-layer banner (e.g. needs sudo) — WS is up but no packets */}
      <CaptureBanner />

      {/* Transient runtime notifications (interface down, capture hiccups) */}
      <Toasts />

      {/* Reconnecting overlay — shown when the WS to the server drops */}
      <ReconnectingOverlay />

      {/* Blocking recovery screen for fatal startup problems */}
      <StartupOverlay />
    </div>
  );
}
