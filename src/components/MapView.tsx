import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { getRenderQueueMemo } from '@/lib/render-queue';
import { interpolateArc, arcPoints, greatCircleKm } from '@/lib/interpolate';
import { flightEndpoints } from '@/lib/arc';
import { markerHeadingDeg } from '@/lib/mesh-orientation';
import { liveProgress } from '@/lib/anim';
import { type Pose } from '@/lib/lifecycle';
import { flightWorldPos } from '@/lib/flight-pos';
import { reducedMotion } from '@/lib/motion';
import { showTip, hideTip, flightTipText } from '@/lib/tooltip';
import { THEME_BY_ID, type Theme } from '@/lib/themes';
import { recolorValue } from '@/lib/map-recolor';
import { AIRCRAFT_ICONS, AIRCRAFT_SIZE } from '@/lib/icons';
import { trailSegmentColor } from '@/lib/trail-color';
import { mapRef } from '@/lib/view-refs';
import { geoFlagLabel, geoMarkerOpacity } from '@/lib/geo-display';
import type { Flight, HomeAirport } from '@/types';

type PaintSnap = { prop: string; value: unknown };

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

// FR24-style selection highlight (falls back to red when no theme accent).
const SELECTED_COLOR = 'var(--theme-accent, #ff3b30)';
const ICON_OUTLINE = 'rgba(0,0,0,0.55)';
const CHIP_BORDER = 'rgba(255,255,255,0.14)';

// Paint an icon path via style (not attributes) so CSS vars work for selection.
// Fill icons get a thin dark outline so livery colors read on light basemaps.
function paintIconPath(path: SVGPathElement, f: Flight, selected: boolean): void {
  const icon = AIRCRAFT_ICONS[f.aircraftType];
  const color = selected ? SELECTED_COLOR : f.liveryColor;
  if (icon.mode === 'fill') {
    path.style.fill = color;
    path.style.stroke = ICON_OUTLINE;
    path.style.strokeWidth = '0.7';
  } else {
    path.style.fill = 'none';
    path.style.stroke = color;
    path.style.strokeWidth = f.aircraftType === 'ambulance' ? '2.6' : '2.2';
  }
}

// NOTE: no CSS filter here — a per-icon drop-shadow forces a re-raster of every
// marker on every transform change (~3x frame cost at 150 planes). The dark
// outline stroke (paintIconPath) provides the same legibility for free.
function iconSvg(f: Flight, size: number): string {
  const icon = AIRCRAFT_ICONS[f.aircraftType];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;overflow:visible"><path d="${icon.d}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function makeMarkerEl(f: Flight): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;cursor:pointer;will-change:transform';
  wrap.dataset.color = f.liveryColor;
  const plane = document.createElement('div');
  plane.dataset.role = 'plane';
  plane.style.cssText =
    'display:flex;align-items:center;justify-content:center;transition:transform .15s,filter .15s,opacity .3s';
  plane.innerHTML = iconSvg(f, AIRCRAFT_SIZE[f.aircraftType]);
  const path = plane.querySelector('path');
  if (path) paintIconPath(path, f, false);
  // FR24-style callsign chip above the plane.
  const label = document.createElement('div');
  label.dataset.role = 'label';
  label.style.cssText =
    `position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:4px;white-space:nowrap;font:600 9px ui-monospace,monospace;color:#e4e4e7;background:rgba(9,9,11,0.72);border:1px solid ${CHIP_BORDER};border-radius:4px;padding:1px 4px;pointer-events:none`;
  label.textContent = `${f.id} ${geoFlagLabel(f)}`;
  wrap.append(plane, label);
  return wrap;
}

// Two-ring landing shockwave (mirrors the 3D globe flare): bright inner ring
// in the livery color + a faster, softer white outer ring.
function spawnFlare(el: HTMLElement, color: string): void {
  const base =
    'position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;border-radius:50%;pointer-events:none;';
  const inner = document.createElement('div');
  inner.style.cssText = `${base}border:2px solid ${color};animation:flare 0.8s ease-out forwards`;
  const outer = document.createElement('div');
  outer.style.cssText = `${base}border:1.5px solid rgba(255,255,255,0.8);animation:flare-outer 0.8s ease-out forwards`;
  el.append(inner, outer);
  setTimeout(() => {
    inner.remove();
    outer.remove();
  }, 820);
}

// Per-marker cached DOM refs + last-written values so the per-frame loop never
// queries the DOM and only writes styles that actually changed.
interface MarkerEntry {
  m: maplibregl.Marker;
  plane: HTMLElement;
  label: HTMLElement;
  svg: SVGElement;
  path: SVGPathElement | null;
  last: {
    heading: number;
    color: string;
    sel: boolean;
    phase: string;
    opacity: number;
    scale: number;
    labelShown: boolean;
    chipText: string;
    lat: number;
    lng: number;
  };
}

function makeMarkerEntry(m: maplibregl.Marker, f: Flight): MarkerEntry {
  const el = m.getElement();
  const plane = el.querySelector('[data-role=plane]') as HTMLElement;
  const label = el.querySelector('[data-role=label]') as HTMLElement;
  return {
    m,
    plane,
    label,
    svg: plane.firstElementChild as SVGElement,
    path: plane.querySelector('path'),
    last: {
      heading: NaN,
      color: f.liveryColor,
      sel: false,
      phase: f.phase,
      opacity: -1,
      scale: -1,
      labelShown: false,
      chipText: label.textContent ?? '',
      lat: NaN,
      lng: NaN,
    },
  };
}

function paintMarker(
  entry: MarkerEntry,
  f: Flight,
  heading: number,
  selected: boolean,
  showLabel: boolean,
  pose: Pose,
): void {
  const { plane, label, svg, path, last } = entry;
  const hd = markerHeadingDeg(heading);
  if (Math.abs(hd - last.heading) > 0.5 || Number.isNaN(last.heading)) {
    svg.style.transform = `rotate(${hd}deg)`;
    last.heading = hd;
  }
  // Repaint on livery OR selection change (selected planes swap to the accent).
  if (last.color !== f.liveryColor || last.sel !== selected) {
    last.color = f.liveryColor;
    last.sel = selected;
    if (path) paintIconPath(path, f, selected);
    plane.style.filter = selected ? `drop-shadow(0 0 5px ${f.liveryColor})` : 'none';
    label.style.color = selected ? '#fff' : '#e4e4e7';
    label.style.fontWeight = selected ? '700' : '600';
    label.style.borderColor = selected ? SELECTED_COLOR : CHIP_BORDER;
  }
  // one-shot landing flare on touchdown
  if (last.phase !== f.phase) {
    if (f.phase === 'landed' && !reducedMotion()) spawnFlare(entry.m.getElement(), f.liveryColor);
    last.phase = f.phase;
  }
  const opacity =
    (f.aircraftType === 'stealth' ? pose.opacity * 0.6 : pose.opacity) * geoMarkerOpacity(f);
  if (opacity !== last.opacity) {
    plane.style.opacity = String(opacity);
    last.opacity = opacity;
  }
  const scale = (selected ? 1.3 : 1) * pose.scale;
  if (scale !== last.scale) {
    plane.style.transform = `scale(${scale})`;
    last.scale = scale;
  }
  const shown = showLabel || selected;
  if (shown !== last.labelShown) {
    label.style.display = shown ? 'block' : 'none';
    last.labelShown = shown;
  }
  if (shown) {
    const text = `${f.id} ${geoFlagLabel(f)}`;
    if (text !== last.chipText) {
      label.textContent = text;
      last.chipText = text;
    }
  }
}

// FR24-style destination pin for the selected flight: flag chip on a stem.
function makeDestPinEl(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none';
  const chip = document.createElement('div');
  chip.dataset.role = 'pin-chip';
  chip.style.cssText =
    'white-space:nowrap;font:600 9px ui-monospace,monospace;color:#fff;background:rgba(9,9,11,0.8);border:1px solid rgba(255,255,255,0.25);border-radius:4px;padding:1px 5px';
  const stem = document.createElement('div');
  stem.style.cssText = 'width:1px;height:7px;background:rgba(255,255,255,0.55)';
  const dot = document.createElement('div');
  dot.style.cssText =
    'width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(255,255,255,0.8)';
  wrap.append(chip, stem, dot);
  return wrap;
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
    function addOverlay() {
      if (map.getSource('arcs')) return;
      map.addSource('arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('dests', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // Selected flight's remaining route: thin dotted line under the trails.
      map.addLayer({
        id: 'route-remaining',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.2,
          'line-opacity': 0.55,
          'line-dasharray': [0.6, 2],
        },
      });
      map.addLayer({
        id: 'arcs-solid',
        type: 'line',
        source: 'arcs',
        filter: ['==', ['get', 'vpn'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.4],
          'line-opacity': ['get', 'op'],
        },
      });
      map.addLayer({
        id: 'arcs-vpn',
        type: 'line',
        source: 'arcs',
        filter: ['==', ['get', 'vpn'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.4],
          'line-opacity': ['get', 'op'],
          'line-dasharray': [2, 2],
        },
      });
      // FR24-style airport markers: outer ring + inner dot, sized by flight count.
      map.addLayer({
        id: 'dests-ring',
        type: 'circle',
        source: 'dests',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 5, 20, 9],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': 'rgba(255,255,255,0.35)',
          'circle-stroke-width': 1.2,
        },
      });
      map.addLayer({
        id: 'dests',
        type: 'circle',
        source: 'dests',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 2.5, 20, 4.5],
          'circle-color': 'rgba(255,255,255,0.9)',
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
          'circle-stroke-width': 1,
        },
      });
    }

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
