import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { getRenderQueueMemo } from '@/lib/render-queue';
import { interpolateArc, arcPoints } from '@/lib/interpolate';
import { flightEndpoints } from '@/lib/arc';
import { correctedLngOffset, markerHeadingDeg } from '@/lib/mesh-orientation';
import { liveProgress } from '@/lib/anim';
import { lifecyclePose, type Pose } from '@/lib/lifecycle';
import { reducedMotion } from '@/lib/motion';
import { showTip, hideTip, flightTipText } from '@/lib/tooltip';
import { THEME_BY_ID, type Theme } from '@/lib/themes';
import { recolorValue } from '@/lib/map-recolor';
import { AIRCRAFT_ICONS, AIRCRAFT_SIZE } from '@/lib/icons';
import { mapRef } from '@/lib/view-refs';
import { geoFlagLabel, geoMarkerOpacity } from '@/lib/geo-display';
import type { Flight, HomeAirport } from '@/types';

type PaintSnap = { prop: string; value: unknown };

// Genuinely recolor the dark-matter vector layers per theme (by layer type), or
// restore the captured originals when the theme has no recolor (Midnight/Positron).
function recolorMap(map: maplibregl.Map, snaps: Map<string, PaintSnap>, theme: Theme): void {
  for (const [id, snap] of snaps) {
    const val = recolorValue(snap.prop, id, theme.mapRecolor) ?? snap.value;
    try {
      map.setPaintProperty(id, snap.prop, val as string);
    } catch {
      /* layer/prop gone after a style swap — ignore */
    }
  }
}

function snapshotPaint(map: maplibregl.Map): Map<string, PaintSnap> {
  const snaps = new Map<string, PaintSnap>();
  for (const layer of map.getStyle().layers ?? []) {
    const prop =
      layer.type === 'background'
        ? 'background-color'
        : layer.type === 'fill'
          ? 'fill-color'
          : layer.type === 'line'
            ? 'line-color'
            : layer.type === 'symbol'
              ? 'text-color'
              : null;
    if (prop) {
      try {
        snaps.set(layer.id, { prop, value: map.getPaintProperty(layer.id, prop) });
      } catch {
        /* ignore */
      }
    }
  }
  return snaps;
}

function iconSvg(f: Flight, size: number): string {
  const icon = AIRCRAFT_ICONS[f.aircraftType];
  const fill = icon.mode === 'fill' ? f.liveryColor : 'none';
  const stroke = icon.mode === 'stroke' ? f.liveryColor : 'none';
  const sw = f.aircraftType === 'ambulance' ? 3 : 2.2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;overflow:visible;transition:transform .1s linear"><path d="${icon.d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function makeMarkerEl(f: Flight): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;cursor:pointer;will-change:transform';
  wrap.dataset.color = f.liveryColor;
  const plane = document.createElement('div');
  plane.dataset.role = 'plane';
  plane.style.cssText =
    'display:flex;align-items:center;justify-content:center;transition:transform .15s,filter .15s';
  plane.innerHTML = iconSvg(f, AIRCRAFT_SIZE[f.aircraftType]);
  const label = document.createElement('div');
  label.dataset.role = 'label';
  label.style.cssText =
    'position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:3px;white-space:nowrap;font:600 9px ui-monospace,monospace;color:#d4d4d8;text-shadow:0 0 3px #000;pointer-events:none';
  label.textContent = `${f.id} ${geoFlagLabel(f)}`;
  wrap.append(plane, label);
  return wrap;
}

function spawnFlare(el: HTMLElement, color: string): void {
  const ring = document.createElement('div');
  ring.style.cssText = `position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;border-radius:50%;border:2px solid ${color};pointer-events:none;animation:flare 0.8s ease-out forwards`;
  el.appendChild(ring);
  setTimeout(() => ring.remove(), 820);
}

function updateMarkerEl(
  el: HTMLElement,
  f: Flight,
  heading: number,
  selected: boolean,
  showLabel: boolean,
  pose: Pose,
): void {
  const plane = el.querySelector('[data-role=plane]') as HTMLElement;
  const label = el.querySelector('[data-role=label]') as HTMLElement;
  const svg = plane.firstElementChild as SVGElement | null;
  if (svg) svg.style.transform = `rotate(${markerHeadingDeg(heading)}deg)`;
  if (el.dataset.color !== f.liveryColor) {
    el.dataset.color = f.liveryColor;
    const path = svg?.querySelector('path');
    if (path) {
      const icon = AIRCRAFT_ICONS[f.aircraftType];
      path.setAttribute('fill', icon.mode === 'fill' ? f.liveryColor : 'none');
      path.setAttribute('stroke', icon.mode === 'stroke' ? f.liveryColor : 'none');
    }
  }
  // one-shot landing flare on touchdown
  if (el.dataset.phase !== f.phase) {
    if (f.phase === 'landed' && el.dataset.phase && !reducedMotion()) spawnFlare(el, f.liveryColor);
    el.dataset.phase = f.phase;
  }
  const opacity = (f.aircraftType === 'stealth' ? pose.opacity * 0.6 : pose.opacity) * geoMarkerOpacity(f);
  plane.style.opacity = String(opacity);
  plane.style.filter = selected ? `drop-shadow(0 0 5px ${f.liveryColor})` : 'none';
  plane.style.transform = `scale(${(selected ? 1.3 : 1) * pose.scale})`;
  label.style.display = showLabel ? 'block' : 'none';
  label.style.color = selected ? '#fff' : '#d4d4d8';
}

function makeHomeEl(home: HomeAirport): HTMLDivElement {
  const color = home.isVpn ? '#8b5cf6' : '#ffffff';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:0;height:0;pointer-events:none';
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:1.5px solid ${color};animation:ring-pulse 3s ease-out ${i}s infinite`;
    wrap.appendChild(ring);
  }
  const dot = document.createElement('div');
  dot.style.cssText = `position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color}`;
  const label = document.createElement('div');
  label.style.cssText = `position:absolute;left:50%;top:12px;transform:translateX(-50%);white-space:nowrap;font:600 10px ui-sans-serif,system-ui;color:${color};text-shadow:0 0 4px #000`;
  label.textContent = home.label;
  wrap.append(dot, label);
  return wrap;
}

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

    const markers = new Map<string, maplibregl.Marker>();
    const homeMarkers: maplibregl.Marker[] = [];
    let loaded = false;

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

    function update() {
      if (!loaded) return;
      const { flights, homeAirports, selectedFlightId } = useFlightsStore.getState();
      const filters = useFiltersStore.getState();
      const { mainQueue, dnsQueue } = getRenderQueueMemo(flights, filters);
      const rendered = [...mainQueue, ...dnsQueue];
      const showLabels = map.getZoom() >= 3;
      const now = performance.now();

      const arcFeatures: Feature[] = [];
      const countryAgg = new Map<string, { lng: number; lat: number; count: number }>();
      const seen = new Set<string>();

      for (const f of rendered) {
        const home = homeAirports.find((a) => a.id === f.homeAirportId);
        if (!home) continue;
        const ep = flightEndpoints(home, f);
        const prog = liveProgress(f); // per-frame animated value (not the 10Hz snapshot)
        // LAN flights orbit the home airport — pin them to home (don't interpolate a
        // destination arc, which would fly them off to wherever dst landed).
        const pos = f.isLan
          ? { lat: home.lat, lng: home.lng, heading: 0 }
          : interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, prog);

        // Lifecycle pose adds an orbit offset (hold-circle / LAN orbit) around the
        // projected position; the lng offset is widened by 1/cos(lat) so the circle
        // stays roughly round away from the equator.
        const pose = lifecyclePose(f, now);
        const mLat = pos.lat + pose.dLat;
        const mLng = pos.lng + correctedLngOffset(pose.dLng, pos.lat);

        let m = markers.get(f.id);
        if (!m) {
          const el = makeMarkerEl(f);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            useFlightsStore.getState().selectFlight(f.id);
          });
          el.addEventListener('mousemove', (ev) => showTip(ev.clientX, ev.clientY, flightTipText(f)));
          el.addEventListener('mouseleave', hideTip);
          m = new maplibregl.Marker({ element: el }).setLngLat([mLng, mLat]).addTo(map);
          markers.set(f.id, m);
        } else {
          m.setLngLat([mLng, mLat]);
        }
        updateMarkerEl(m.getElement(), f, pos.heading, f.id === selectedFlightId, showLabels, pose);
        seen.add(f.id);

        if (!f.isLan && f.phase !== 'taxi' && f.phase !== 'landed') {
          arcFeatures.push({
            type: 'Feature',
            properties: { color: f.liveryColor, vpn: home.isVpn },
            geometry: {
              type: 'LineString',
              coordinates: arcPoints(ep.startLat, ep.startLng, ep.endLat, ep.endLng, prog),
            },
          });
        }
        if (!countryAgg.has(f.country)) {
          countryAgg.set(f.country, { lng: f.dstLng, lat: f.dstLat, count: 0 });
        }
        countryAgg.get(f.country)!.count++;
      }

      for (const [id, m] of markers) {
        if (!seen.has(id)) {
          m.remove();
          markers.delete(id);
        }
      }

      const arcSrc = map.getSource('arcs') as maplibregl.GeoJSONSource | undefined;
      arcSrc?.setData({ type: 'FeatureCollection', features: arcFeatures } as FeatureCollection);

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
    }

    // The arc/dest overlay must be (re)added on every style — setStyle (theme
    // swap) drops custom sources/layers. Idempotent.
    function addOverlay() {
      if (map.getSource('arcs')) return;
      map.addSource('arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('dests', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'arcs-solid',
        type: 'line',
        source: 'arcs',
        filter: ['==', ['get', 'vpn'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.6 },
      });
      map.addLayer({
        id: 'arcs-vpn',
        type: 'line',
        source: 'arcs',
        filter: ['==', ['get', 'vpn'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.6,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: 'dests',
        type: 'circle',
        source: 'dests',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 3, 20, 7],
          'circle-color': 'rgba(255,255,255,0.55)',
          'circle-stroke-color': 'rgba(255,255,255,0.25)',
          'circle-stroke-width': 1,
        },
      });
    }

    // dest interactions — registered once (keyed by layer id, survive restyle).
    map.on('click', 'dests', (e) => {
      const c = e.features?.[0]?.properties?.country;
      if (typeof c === 'string') useFiltersStore.getState().setIsolatedCountry(c);
    });
    map.on('mouseenter', 'dests', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'dests', () => (map.getCanvas().style.cursor = ''));

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

    // Semantic updates (10Hz worst case): create/remove markers + rebuild home
    // markers on the rare home change. This makes markers appear immediately on a
    // store push rather than waiting for the next animation frame.
    const unsubFlights = useFlightsStore.subscribe((st, prev) => {
      if (st.homeAirports !== prev.homeAirports) renderHome(st.homeAirports);
      if (st.flights !== prev.flights || st.selectedFlightId !== prev.selectedFlightId) update();
    });
    const unsubFilters = useFiltersStore.subscribe(() => update());

    // Own per-frame loop: update() reads arcProgressLive each frame for smooth
    // motion, independent of the now-10Hz store.
    let frameRaf = 0;
    const frame = () => {
      update();
      frameRaf = requestAnimationFrame(frame);
    };
    frameRaf = requestAnimationFrame(frame);

    return () => {
      unsubFlights();
      unsubFilters();
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
