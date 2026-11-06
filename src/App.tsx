import { lazy, Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { useFlightsStore } from '@/store/flights';
import { applyTheme } from '@/lib/themes';
import { getRenderQueueMemo } from '@/lib/render-queue';
import { locateFlight } from '@/lib/locate';
import { useDemoFlights } from '@/lib/demo';
import { useLiveFlights } from '@/lib/live';
import FlightCard from '@/components/FlightCard';
import FilterPanel from '@/components/FilterPanel';
import { Board } from '@/components/Board';
import RadarHUD from '@/components/RadarHUD';
import MetricsStrip from '@/components/MetricsStrip';
import ReconnectingOverlay from '@/components/ReconnectingOverlay';
import NoticeStack from '@/components/NoticeStack';
import StartupOverlay from '@/components/StartupOverlay';
import ErrorBoundary from '@/components/ErrorBoundary';
import FilterChips from '@/components/FilterChips';
import Legend from '@/components/Legend';
import About from '@/components/About';
import SceneAnnouncer from '@/components/SceneAnnouncer';
import FpsOverlay from '@/components/FpsOverlay';
import SessionStats from '@/components/SessionStats';
import { useDiagnosticsStore } from '@/store/diagnostics';

// Code-split both heavy views: MapView pulls in the ~2 MB maplibre-gl chunk and
// GlobeView the ~3 MB three.js chunk, which the entry bundle + first paint
// shouldn't have to carry. Each is loaded on first render of its view mode.
const MapView = lazy(() =>
  import('@/components/MapView').catch((err) => {
    useDiagnosticsStore.getState().recordChunkError('MapView', err);
    throw err;
  }),
);
const GlobeView = lazy(() =>
  import('@/components/GlobeView').catch((err) => {
    useDiagnosticsStore.getState().recordChunkError('GlobeView', err);
    throw err;
  }),
);

// Step selection through the on-screen flights — a keyboard alternative to
// clicking individual planes on the canvas. The new selection is announced by
// SceneAnnouncer's live region and centered in the active view.
function cycleFlight(dir: 1 | -1): void {
  const fs = useFlightsStore.getState();
  const { mainQueue, dnsQueue } = getRenderQueueMemo(fs.flights, useFiltersStore.getState());
  const list = [...mainQueue, ...dnsQueue];
  if (list.length === 0) return;
  const idx = list.findIndex((f) => f.id === fs.selectedFlightId);
  const nextIdx =
    idx < 0 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
  const next = list[nextIdx];
  fs.selectFlight(next.id);
  locateFlight(
    next,
    fs.homeAirports.find((a) => a.id === next.homeAirportId),
  );
}

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
      if (e.key === 'Escape') {
        const f = useFiltersStore.getState();
        if (f.aboutOpen) f.setAbout(false);
        else if (f.legendOpen) f.setLegend(false);
        else if (f.filterDrawerOpen) f.toggleFilterDrawer();
        else if (useFlightsStore.getState().selectedFlightId) {
          useFlightsStore.getState().selectFlight(null);
        }
        return;
      }
      // Single-key shortcuts: F filters, L legend, G 2D/3D. Never while typing
      // or with a modifier held (Shift+F is the dev FPS overlay).
      const typing = (() => {
        const el = document.activeElement as HTMLElement | null;
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      })();
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const f = useFiltersStore.getState();
        const k = e.key.toLowerCase();
        if (k === 'f') return f.toggleFilterDrawer();
        if (k === 'l') return f.toggleLegend();
        if (k === 'g') return f.setViewMode(f.viewMode === '2d' ? '3d' : '2d');
      }
      // [ / ] step backward / forward through the on-screen flights — keyboard
      // access to planes (the canvas markers aren't individually focusable).
      if (e.key === '[' || e.key === ']') {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
          return; // don't hijack typing in the app-search field
        }
        e.preventDefault();
        cycleFlight(e.key === ']' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Screen-reader scene description + selected-flight live region (the map
          itself is a canvas and invisible to assistive tech). */}
      <ErrorBoundary>
        <SceneAnnouncer />
      </ErrorBoundary>

      {/* Map / globe fills the screen; ErrorBoundary keeps a view crash (e.g. the
          lazy globe chunk) from white-screening the whole app. */}
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
            </div>
          }
        >
          {viewMode === '2d' ? <MapView /> : <GlobeView />}
        </Suspense>
      </ErrorBoundary>

      {/* HUD overlays — radar hides on very narrow viewports */}
      <div className="absolute left-4 top-4 z-10 hidden min-[700px]:block">
        <RadarHUD />
        <SessionStats />
      </div>
      <div className="absolute right-4 top-4 z-20 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        <MetricsStrip />
        <FilterChips />
      </div>
      <Legend />
      <About />
      {/* Bottom row: tabbed board · docked flight card. Phones stack them
          (card above, board below) so neither gets squeezed. */}
      {/* Safety net: a bad flight must not blank the whole app via the HUD. */}
      <ErrorBoundary>
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex items-end gap-2 px-4 max-[700px]:flex-col-reverse max-[700px]:items-stretch">
          <div className="pointer-events-auto shrink-0">
            <Board />
          </div>
          <FlightCard />
        </div>
      </ErrorBoundary>

      {/* Filter drawer (shadcn Sheet) */}
      <FilterPanel />

      {/* Capture banner (sudo) + transient toasts, stacked top-center */}
      <NoticeStack />

      {/* Reconnecting overlay — shown when the WS to the server drops */}
      <ReconnectingOverlay />

      {/* Blocking recovery screen for fatal startup problems */}
      <StartupOverlay />

      <FpsOverlay />
    </div>
  );
}
