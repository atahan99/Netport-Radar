import { lazy, Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { useFlightsStore } from '@/store/flights';
import { applyTheme } from '@/lib/themes';
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
import NoticeStack from '@/components/NoticeStack';
import StartupOverlay from '@/components/StartupOverlay';
import ErrorBoundary from '@/components/ErrorBoundary';
import FilterChips from '@/components/FilterChips';
import Legend from '@/components/Legend';
import SceneAnnouncer from '@/components/SceneAnnouncer';

// Code-split the 3D globe: it pulls in the ~3 MB three.js chunk, which the
// default 2D map + first paint shouldn't have to carry. Loaded on first switch.
const GlobeView = lazy(() => import('@/components/GlobeView'));

export default function App() {
  const viewMode = useFiltersStore((s) => s.viewMode);
  // Live capture by default; demo generator behind VITE_DEMO=1 for offline UI work.
  const demo = import.meta.env.VITE_DEMO === '1';
  useDemoFlights(demo);
  useLiveFlights(!demo);

  // Apply the selected color theme (map filter, globe atmosphere, HUD accent, bg).
  const theme = useFiltersStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Esc priority: close the legend, else the filter drawer, else deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const f = useFiltersStore.getState();
      if (f.legendOpen) f.setLegend(false);
      else if (f.filterDrawerOpen) f.toggleFilterDrawer();
      else if (useFlightsStore.getState().selectedFlightId) {
        useFlightsStore.getState().selectFlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Screen-reader scene description + selected-flight live region (the map
          itself is a canvas and invisible to assistive tech). */}
      <SceneAnnouncer />

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

      {/* Wordmark behind the HUD — tinted by the active theme accent (decorative) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-5 z-0 text-center text-sm font-semibold tracking-[0.35em]"
        style={{ color: 'var(--theme-accent, #3f3f46)', opacity: 0.4 }}
      >
        NETPORT·RADAR
      </div>

      {/* HUD overlays — radar hides on very narrow viewports */}
      <div className="absolute left-4 top-4 z-10 hidden min-[700px]:block">
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
      <div className="absolute bottom-4 right-4 z-10 hidden min-[900px]:block">
        <ArrivalsBoard />
      </div>

      {/* Flight card — anchored or docked per toggle; rendered at root */}
      <FlightCard />

      {/* Filter drawer (shadcn Sheet) */}
      <FilterPanel />

      {/* Capture banner (sudo) + transient toasts, stacked top-center */}
      <NoticeStack />

      {/* Reconnecting overlay — shown when the WS to the server drops */}
      <ReconnectingOverlay />

      {/* Blocking recovery screen for fatal startup problems */}
      <StartupOverlay />
    </div>
  );
}
