import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
// MapLibre 6 resolves its tile worker relative to its own module URL, which
// doesn't survive Vite's dependency pre-bundling. Let Vite bundle the worker
// (shared chunk included) and hand MapLibre the URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection } from 'geojson';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { getRenderQueueMemo } from '@/lib/render-queue';
import { interpolateArc, arcPoints, greatCircleKm } from '@/lib/interpolate';
import { flightEndpoints } from '@/lib/arc';
import { liveProgress } from '@/lib/anim';
import { flightWorldPos } from '@/lib/flight-pos';
import { showTip, hideTip, flightTipText } from '@/lib/tooltip';
import { THEME_BY_ID } from '@/lib/themes';
import { recolorMap, snapshotPaint, type PaintSnap } from '@/lib/map-theme';
import { addFlightOverlay } from '@/lib/map-layers';
import {
  makeMarkerEl,
  makeMarkerEntry,
  paintMarker,
  makeDestPinEl,
  makeHomeEl,
  type MarkerEntry,
} from '@/lib/map-markers';
import { trailSegmentColor } from '@/lib/trail-color';
import { mapRef } from '@/lib/view-refs';
import type { HomeAirport } from '@/types';

// 2D trail sampling: arc resolution + gradient segment count per flight.
// Short arcs sample fewer points (adaptive), long arcs keep full resolution.
const TRAIL_STEPS_2D = 48;
const TRAIL_STEPS_SHORT = 24;
const TRAIL_SEGS = 8;
// Overlay (trails/route/dests) rebuild cadence — the store itself is 10Hz, so
// rebuilding GeoJSON faster than this only re-tessellates identical lines.
const OVERLAY_MS = 100;
// Chip declutter: max non-selected chips at mid zoom, ranked by throughput.
const TOP_CHIPS = 15;


maplibregl.setWorkerUrl(maplibreWorkerUrl);

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useFiltersStore((s) => s.theme);
  // Ref-backed theme state shared between the map-setup effect and the
  // theme-change effect below: the pristine basemap paint snapshot + the last
  // base style we applied (to decide recolor-in-place vs. full setStyle).
  const themeCtl = useRef<{ snaps: Map<string, PaintSnap>; lastStyle: string | object }>({
    snaps: new Map(),
    lastStyle: (THEME_BY_ID[useFiltersStore.getState().theme] ?? THEME_BY_ID.midnight).mapStyle,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const initialTheme = THEME_BY_ID[useFiltersStore.getState().theme] ?? THEME_BY_ID.midnight;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialTheme.mapStyle,
      center: [15, 30],
      zoom: 2,
      attributionControl: false, // added below so we can place + collapse it
      maxZoom: 12,
    });
    mapRef.current = map;
    // Compact "ⓘ" (collapsed by default) tucked under the top-right HUD cluster —
    // Carto/OSM/Esri tile usage requires attribution. CSS nudges it below the
    // metrics strip so it doesn't sit over the arrivals board (bottom-right).
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');

    const markers = new Map<string, MarkerEntry>();
    const destBadges = new Map<string, { m: maplibregl.Marker; el: HTMLElement; last: string }>();
    let destPin: { m: maplibregl.Marker; chip: HTMLElement; last: string } | null = null;
    const homeMarkers: maplibregl.Marker[] = [];
    let loaded = false;
    // Chip declutter: ids allowed to show a chip at mid zoom (top throughput),
    // refreshed at overlay cadence.
    let topChips = new Set<string>();
    // Overlay change-detection: signature of everything the overlay output
    // depends on. When it's unchanged (idle flights: hold/taxi/landed), skip
    // the whole rebuild — no GeoJSON, no setData, no re-tessellation.
    let lastOverlaySig = '';

    function renderHome(homeAirports: HomeAirport[]) {
      for (const m of homeMarkers) m.remove();
      homeMarkers.length = 0;
      for (const a of homeAirports) {
        const m = new maplibregl.Marker({ element: makeHomeEl(a) })
          .setLngLat([a.lng, a.lat])
          .addTo(map);
        homeMarkers.push(m);
      }
    }

    // ── per-frame path: marker positions + poses only (cheap) ───────────────
    function updateMarkers() {
      if (!loaded) return;
      const { flights, homeAirports, selectedFlightId } = useFlightsStore.getState();
      const filters = useFiltersStore.getState();
      const { mainQueue, dnsQueue } = getRenderQueueMemo(flights, filters);
      const rendered = [...mainQueue, ...dnsQueue];
      const zoom = map.getZoom();
      const now = performance.now();
      const seen = new Set<string>();

      for (const f of rendered) {
        const home = homeAirports.find((a) => a.id === f.homeAirportId);
        if (!home) continue;
        const { lat: mLat, lng: mLng, heading, pose } = flightWorldPos(f, home, now);

        let entry = markers.get(f.id);
        if (!entry) {
          const el = makeMarkerEl(f);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            useFlightsStore.getState().selectFlight(f.id);
          });
          el.addEventListener('mousemove', (ev) => showTip(ev.clientX, ev.clientY, flightTipText(f)));
          el.addEventListener('mouseleave', hideTip);
          const m = new maplibregl.Marker({ element: el }).setLngLat([mLng, mLat]).addTo(map);
          entry = makeMarkerEntry(m, f);
          entry.last.lat = mLat;
          entry.last.lng = mLng;
          markers.set(f.id, entry);
        } else if (
          // Skip the (surprisingly costly) setLngLat → projection → transform
          // write for planes that haven't visibly moved (taxi, landed, most of
          // a hold orbit frame-to-frame at world zoom).
          Math.abs(entry.last.lat - mLat) > 1e-6 ||
          Math.abs(entry.last.lng - mLng) > 1e-6
        ) {
          entry.last.lat = mLat;
          entry.last.lng = mLng;
          entry.m.setLngLat([mLng, mLat]);
        }
        const selected = f.id === selectedFlightId;
        // Chip declutter: unknown-geo flights never get chips (they stack on the
        // shelf); mid zoom shows only the top throughput flights; high zoom all.
        const showChip =
          f.geoConfidence !== 'none' && (zoom >= 5 || (zoom >= 3 && topChips.has(f.id)));
        paintMarker(entry, f, heading, selected, showChip, pose);
        seen.add(f.id);
      }

      for (const [id, entry] of markers) {
        if (!seen.has(id)) {
          entry.m.remove();
          markers.delete(id);
        }
      }
    }

    // ── throttled path (~10Hz): trail/route/dest GeoJSON + chip ranking ─────
    // Rebuilding these per rAF made MapLibre re-tessellate ~1200 line features
    // every frame (the 20fps bottleneck); the store only updates at 10Hz anyway.
    function updateOverlays() {
      if (!loaded) return;
      const { flights, homeAirports, selectedFlightId } = useFlightsStore.getState();
      const filters = useFiltersStore.getState();
      const { mainQueue, dnsQueue } = getRenderQueueMemo(flights, filters);
      const rendered = [...mainQueue, ...dnsQueue];

      // Cheap signature of every input the overlays derive from: per-flight
      // id/phase/progress/color/isLan (membership changes change the id list),
      // coarse bytesPerSec (chip ranking only cares about material changes),
      // plus selection and trail style. Unchanged ⇒ nothing below would differ,
      // so skip the rebuild, setData calls, badge/chip/pin updates entirely.
      let sig = `${selectedFlightId ?? ''}|${filters.trailStyle}`;
      for (const f of rendered) {
        sig += `|${f.id};${f.phase};${liveProgress(f).toFixed(3)};${f.liveryColor};${f.isLan ? 1 : 0};${Math.round(f.bytesPerSec / 1024)}`;
      }
      if (sig === lastOverlaySig) return;
      lastOverlaySig = sig;

      const arcFeatures: Feature[] = [];
      const routeFeatures: Feature[] = [];
      const countryAgg = new Map<string, { lng: number; lat: number; count: number }>();

      for (const f of rendered) {
        const home = homeAirports.find((a) => a.id === f.homeAirportId);
        if (!home) continue;
        const ep = flightEndpoints(home, f);
        const prog = liveProgress(f);

        if (!f.isLan && f.phase !== 'taxi' && f.phase !== 'landed') {
          // FR24-style trail: split the traveled arc into segments whose opacity
          // ramps quadratically toward the plane (transparent at origin), since
          // MapLibre line-gradient can't be data-driven per feature.
          const km = greatCircleKm(ep.startLat, ep.startLng, ep.endLat, ep.endLng);
          const steps = km < 2000 ? TRAIL_STEPS_SHORT : TRAIL_STEPS_2D;
          const pts = arcPoints(ep.startLat, ep.startLng, ep.endLat, ep.endLng, prog, steps);
          for (let s = 0; s < TRAIL_SEGS; s++) {
            const from = Math.floor((s * (pts.length - 1)) / TRAIL_SEGS);
            const to = Math.floor(((s + 1) * (pts.length - 1)) / TRAIL_SEGS);
            if (to <= from) continue;
            const t = (s + 1) / TRAIL_SEGS;
            arcFeatures.push({
              type: 'Feature',
              properties: {
                color: trailSegmentColor(f.liveryColor, s, TRAIL_SEGS, prog, filters.trailStyle),
                vpn: home.isVpn,
                op: t * t * 0.85,
              },
              geometry: { type: 'LineString', coordinates: pts.slice(from, to + 1) },
            });
          }
          // Selected flight: FR24-style remaining (estimated) route to the
          // destination as a thin dashed line ahead of the plane.
          if (f.id === selectedFlightId && prog < 1) {
            const pos = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, prog);
            const full = arcPoints(ep.startLat, ep.startLng, ep.endLat, ep.endLng, 1, steps);
            const idx = Math.min(full.length - 1, Math.ceil(prog * steps));
            routeFeatures.push({
              type: 'Feature',
              properties: { color: f.liveryColor },
              geometry: {
                type: 'LineString',
                coordinates: [[pos.lng, pos.lat] as [number, number], ...full.slice(idx)],
              },
            });
          }
        }
        if (!countryAgg.has(f.country)) {
          countryAgg.set(f.country, { lng: f.dstLng, lat: f.dstLat, count: 0 });
        }
        countryAgg.get(f.country)!.count++;
      }

      const arcSrc = map.getSource('arcs') as maplibregl.GeoJSONSource | undefined;
      arcSrc?.setData({ type: 'FeatureCollection', features: arcFeatures } as FeatureCollection);
      const routeSrc = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      routeSrc?.setData({ type: 'FeatureCollection', features: routeFeatures } as FeatureCollection);

      const destFeatures: Feature[] = [];
      for (const [country, agg] of countryAgg) {
        destFeatures.push({
          type: 'Feature',
          properties: { country, count: agg.count },
          geometry: { type: 'Point', coordinates: [agg.lng, agg.lat] },
        });
      }
      const destSrc = map.getSource('dests') as maplibregl.GeoJSONSource | undefined;
      destSrc?.setData({ type: 'FeatureCollection', features: destFeatures } as FeatureCollection);

      // Chip ranking for mid-zoom declutter: top throughput flights get chips.
      const ranked = rendered
        .filter((f) => f.geoConfidence !== 'none')
        .sort((a, b) => b.bytesPerSec - a.bytesPerSec)
        .slice(0, TOP_CHIPS);
      topChips = new Set(ranked.map((f) => f.id));

      // Destination count badges (DOM, ~10 elements at 10Hz): counts for busy
      // dests; the unknown shelf gets a labeled "?? · N" so stacked unknown
      // flights read as one group instead of a chip pile.
      const seenBadges = new Set<string>();
      for (const [country, agg] of countryAgg) {
        const isShelf = country === '??';
        if (!isShelf && agg.count < 3) continue;
        seenBadges.add(country);
        const text = isShelf ? `?? unknown · ${agg.count}` : String(agg.count);
        let badge = destBadges.get(country);
        if (!badge) {
          const el = document.createElement('div');
          el.style.cssText =
            'transform:translateY(14px);white-space:nowrap;font:600 9px ui-monospace,monospace;color:rgba(255,255,255,0.75);background:rgba(9,9,11,0.65);border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:0 3px;pointer-events:none';
          const m = new maplibregl.Marker({ element: el }).setLngLat([agg.lng, agg.lat]).addTo(map);
          badge = { m, el, last: '' };
          destBadges.set(country, badge);
        } else {
          badge.m.setLngLat([agg.lng, agg.lat]);
        }
        if (badge.last !== text) {
          badge.el.textContent = text;
          badge.last = text;
        }
      }
      for (const [country, badge] of destBadges) {
        if (!seenBadges.has(country)) {
          badge.m.remove();
          destBadges.delete(country);
        }
      }

      // Destination pin for the selected flight (flag + place on a stem).
      const sel = selectedFlightId ? rendered.find((f) => f.id === selectedFlightId) : undefined;
      if (sel && !sel.isLan && sel.geoConfidence !== 'none') {
        const text = `${sel.countryFlag} ${sel.city || sel.country}`.trim();
        if (!destPin) {
          const el = makeDestPinEl();
          const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([sel.dstLng, sel.dstLat])
            .addTo(map);
          destPin = { m, chip: el.querySelector('[data-role=pin-chip]') as HTMLElement, last: '' };
        } else {
          destPin.m.setLngLat([sel.dstLng, sel.dstLat]);
        }
        if (destPin.last !== text) {
          destPin.chip.textContent = text;
          destPin.last = text;
        }
      } else if (destPin) {
        destPin.m.remove();
        destPin = null;
      }
    }

    function update() {
      updateMarkers();
      updateOverlays();
    }

    // The arc/dest overlay must be (re)added on every style — setStyle (theme
    // swap) drops custom sources/layers. Idempotent.
    const addOverlay = () => addFlightOverlay(map);

    // dest interactions — registered once (keyed by layer id, survive restyle).
    for (const layerId of ['dests', 'dests-ring']) {
      map.on('click', layerId, (e) => {
        const c = e.features?.[0]?.properties?.country;
        if (typeof c === 'string') useFiltersStore.getState().setIsolatedCountry(c);
      });
      map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
    }

    // style.load fires on the initial load AND after every setStyle (theme swap).
    // Snapshot the pristine basemap paint BEFORE adding our overlay so recolor
    // never touches the arc/dest layers (they keep their data-driven colors).
    map.on('style.load', () => {
      loaded = true;
      themeCtl.current.snaps = snapshotPaint(map);
      addOverlay();
      const t = THEME_BY_ID[useFiltersStore.getState().theme] ?? THEME_BY_ID.midnight;
      themeCtl.current.lastStyle = t.mapStyle;
      recolorMap(map, themeCtl.current.snaps, t);
      renderHome(useFlightsStore.getState().homeAirports);
      update();
    });

    map.on('click', () => useFlightsStore.getState().selectFlight(null));
    map.on('dragstart', hideTip);

    // Semantic updates: rebuild home markers on the rare home change only.
    // Flight/selection/filter changes are NOT handled here — the ~30Hz frame
    // loop already calls updateMarkers(), so a subscription-driven call would
    // just duplicate that work (worst case a change shows one frame, ~33ms,
    // later — visually identical).
    const unsubFlights = useFlightsStore.subscribe((st, prev) => {
      if (st.homeAirports !== prev.homeAirports) renderHome(st.homeAirports);
    });

    // Frame loop. Two throttles, both measured against a 150-plane burst:
    //  • markers update every OTHER frame — compositing 150+ DOM markers with
    //    fresh transforms every frame is the dominant render cost, and at a
    //    few px/sec of on-screen motion 30-60Hz is visually identical;
    //  • GeoJSON overlays rebuild at OVERLAY_MS — MapLibre re-tessellating all
    //    trail lines per rAF was the other frame-rate killer.
    let frameRaf = 0;
    let lastOverlay = 0;
    let frameParity = false;
    const frame = (now: number) => {
      // Hidden tab: rAF is throttled anyway, but skip the work outright so a
      // background tab does zero marker/overlay updates.
      if (document.hidden) {
        frameRaf = requestAnimationFrame(frame);
        return;
      }
      try {
        frameParity = !frameParity;
        if (frameParity) updateMarkers();
        if (now - lastOverlay >= OVERLAY_MS) {
          lastOverlay = now;
          updateOverlays();
        }
      } finally {
        frameRaf = requestAnimationFrame(frame); // one bad frame must not stop the map
      }
    };
    frameRaf = requestAnimationFrame(frame);

    return () => {
      unsubFlights();
      cancelAnimationFrame(frameRaf);
      hideTip();
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Apply the theme on change: recolor in place when the base style is unchanged
  // (instant, no tile reload), else setStyle (its style.load re-adds the overlay,
  // re-snapshots, and recolors). Driven by a React effect off the store value so
  // it reliably fires — the previous manual store.subscribe closure did not.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = THEME_BY_ID[theme] ?? THEME_BY_ID.midnight;
    if (t.mapStyle !== themeCtl.current.lastStyle) {
      themeCtl.current.lastStyle = t.mapStyle;
      map.setStyle(t.mapStyle as maplibregl.StyleSpecification);
    } else {
      // Recolor unconditionally. Do NOT gate on map.isStyleLoaded(): the arc
      // GeoJSON source is re-set every ~100ms, so isStyleLoaded() is false most
      // of the time and would skip the recolor (it only took effect on reload).
      // setPaintProperty needs only the style to exist; recolorMap's per-layer
      // try/catch swallows the rare "style not ready" case (initial mount).
      recolorMap(map, themeCtl.current.snaps, t);
      map.triggerRepaint();
    }
  }, [theme]);

  // Outer div owns the absolute-inset sizing; the inner div is MapLibre's
  // container (MapLibre forces position:relative on it, which would cancel
  // inset-0 if applied directly — so it gets h-full/w-full instead).
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
