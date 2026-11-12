import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { useFlightsStore } from '@/store/flights';
import { useShallow } from 'zustand/react/shallow';
import { useFiltersStore, selectFilterData } from '@/store/filters';
import { getRenderQueueMemo } from '@/lib/render-queue';
import { flightEndpoints } from '@/lib/arc';
import {
  globeBorderColor,
  useVectorPolygons,
  polygonStrokeColor,
  borderAlphaForAltitude,
  rgba,
} from '@/lib/globe-color';
import { globeMaterialFor } from '@/lib/globe-material';
import { interpolateArc, arcPoints, greatCircleKm, arcAltitude } from '@/lib/interpolate';
import { createPlaneMesh, disposeUnusedMaterials } from '@/lib/globe-meshes';
import { trailPathColors } from '@/lib/trail-color';
import { liveProgress } from '@/lib/anim';
import { reducedMotion } from '@/lib/motion';
import { showTip, hideTip, flightTipText } from '@/lib/tooltip';
import { THEME_BY_ID } from '@/lib/themes';
import { globeRef as sharedGlobeRef, type GlobeApi } from '@/lib/view-refs';
import LeaderLine from '@/components/LeaderLine';
import { positionPlaneMesh, pickFlightAt } from '@/lib/globe-planes';
import { trailWidth } from '@/lib/trail-width';
import { aggregateRoutes, type Route } from '@/lib/routes';
import {
  asF,
  pathPointAlt,
  pathStroke,
  ringLat,
  ringLng,
  ringColor,
  ringRepeatPeriod,
  labelText,
  labelColor,
  pointLat,
  pointLng,
  pointRadius,
  pointColor,
  onPointClick,
  polygonCapColorFn,
  polygonSideColorFn,
  type DestDot,
  type TrailDatum,
} from '@/lib/globe-accessors';
import type { Flight, HomeAirport } from '@/types';

const TRAIL_STEPS = 16;
const TRAIL_STEPS_SEL = 32; // higher resolution for the selected flight
const REMAIN_STEPS = 24; // remaining-route samples (selected flight only)
// LOD: beyond this camera distance from the globe center (radius 100), planes
// render as dots instead of detailed silhouettes. Above react-globe.gl's
// untouched default camera (altitude 2.5 ≈ 350) so silhouettes show even
// before the home airport arrives; dots only when the user zooms well out.
const LOD_FAR_DIST = 360;
// Default camera altitude — close enough that planes read as silhouettes.
const DEFAULT_ALT = 1.7;


// Stable empty list so react-globe.gl doesn't rebuild polygons every render when
// the theme has no country layer (Midnight / Satellite keep the photo earth).
const NO_POLYGONS: object[] = [];
const NO_ITEMS: object[] = [];

// Grouped-view arc accessors (module-level: identity-stable).
const asR = (d: object) => d as Route;
const arcStartLat = (d: object) => asR(d).home.lat;
const arcStartLng = (d: object) => asR(d).home.lng;
const arcEndLat = (d: object) => asR(d).lat;
const arcEndLng = (d: object) => asR(d).lng;
// arcStroke is in degrees (tube width), not pixels.
const arcStroke = (d: object) => 0.15 + 0.15 * trailWidth(asR(d).bytesPerSec, false);


export default function GlobeView() {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const flights = useFlightsStore((s) => s.flights);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const filters = useFiltersStore(useShallow(selectFilterData));
  const themeId = useFiltersStore((s) => s.theme);
  const theme = THEME_BY_ID[themeId];
  const aggregate = useFiltersStore((s) => s.aggregate);
  const arcColor = useCallback(() => theme.accent, [theme]);
  const idleTimer = useRef<number | undefined>(undefined);
  const rendererRef = useRef<{ forceContextLoss(): void } | null>(null);

  // Refs so accessors below can be identity-stable (never trigger layer rebuilds).
  // Kept in sync via effects (not written during render) so the rAF ticker and
  // accessors read the latest home/selection without rebuilding globe layers.
  const homeRef = useRef(homeAirports);
  const selRef = useRef(selectedId);
  useEffect(() => {
    homeRef.current = homeAirports;
  }, [homeAirports]);
  useEffect(() => {
    selRef.current = selectedId;
  }, [selectedId]);
  const homeById = useCallback(
    (id: string): HomeAirport | undefined => homeRef.current.find((a) => a.id === id),
    [],
  );

  // Mesh registry: three.js plane objects keyed by flightId, written when the
  // custom layer creates them and read by the per-frame ticker below. renderedRef
  // mirrors the (now-10Hz) customLayerData so the ticker knows which flights exist.
  const meshById = useRef(new Map<string, THREE.Object3D>());
  const renderedRef = useRef<Flight[]>([]);
  // Camera-far flag (LOD), computed once per frame by the rAF ticker.
  const farRef = useRef(false);
  // Home-centering state: on a fresh restart with the 3D view persisted, the
  // globe mounts before the server's init delivers homeAirports, so the ready
  // handler can't center on home. These let the effect below re-point exactly
  // once when home arrives — unless the user has already moved the camera.
  const userMovedRef = useRef(false);
  const homePointedRef = useRef(false);

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    sharedGlobeRef.current = (globe.current as unknown as GlobeApi) ?? null;
    return () => {
      sharedGlobeRef.current = null;
    };
  });

  // 3D globe surface per theme: a shader-recolored real earth (luminance →
  // water/land remap, cached per theme in lib/globe-material.ts). The texture
  // is managed by the material, so globeImageUrl stays null — three-globe must
  // not stomp the material's map.
  const globeMaterial = useMemo(() => globeMaterialFor(theme), [theme]);

  // Country shapes for the themed border strokes, vendored locally. Fetched
  // once when the globe mounts; absent until then (sphere only).
  const [countries, setCountries] = useState<object[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/geo/countries-110m.geojson')
      .then((r) => r.json())
      .then((d: { features?: object[] }) => {
        if (alive) setCountries(d.features ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Polygon accessors — stable per theme so react-globe.gl doesn't rebuild
  // every render. Caps are transparent (the terrain comes from the shader
  // material); polygons contribute crisp themed border strokes only.
  const borderColor = globeBorderColor(theme);
  const [borderAlpha, setBorderAlpha] = useState(() => borderAlphaForAltitude(DEFAULT_ALT));
  const polygonStrokeColorFn = useCallback(
    () => polygonStrokeColor(borderColor, borderAlpha),
    [borderColor, borderAlpha],
  );
  // Bucketed, so this only re-renders when the fade visibly changes.
  const onZoom = useCallback((pov: { altitude: number }) => {
    setBorderAlpha(borderAlphaForAltitude(pov.altitude));
  }, []);
  const polygonsData = useVectorPolygons(theme) ? countries : NO_POLYGONS;

  useEffect(() => {
    const c = globe.current?.controls() as { autoRotate: boolean } | undefined;
    if (c) c.autoRotate = !selectedId && !reducedMotion();
  }, [selectedId]);

  // Center on the home airport when it arrives after mount (fresh restart with
  // the 3D view persisted) — once, and never over a user-moved camera.
  useEffect(() => {
    if (homePointedRef.current || userMovedRef.current) return;
    const g = globe.current;
    const primary = homeAirports.find((a) => a.id === 'primary') ?? homeAirports[0];
    if (!g || !primary) return;
    homePointedRef.current = true;
    g.pointOfView({ lat: primary.lat, lng: primary.lng, altitude: DEFAULT_ALT }, 600);
  }, [homeAirports]);

  // Plane meshes update every frame (cheap). Trails + dots are throttled to
  // ~11fps via state so their geometry doesn't rebuild 60×/sec.
  const { mainQueue, dnsQueue } = useMemo(
    () => getRenderQueueMemo(flights, filters),
    [flights, filters],
  );
  const rendered = useMemo(() => [...mainQueue, ...dnsQueue], [mainQueue, dnsQueue]);
  useEffect(() => {
    renderedRef.current = rendered;
  }, [rendered]);

  const [trailData, setTrailData] = useState<TrailDatum[]>([]);
  const [destData, setDestData] = useState<DestDot[]>([]);
  const [routeData, setRouteData] = useState<Route[]>([]);
  useEffect(() => {
    // Signature of everything trailData/destData depend on. When it hasn't
    // changed since the last tick (all flights idle: taxi/hold/landed), skip
    // the state pushes so react-globe.gl doesn't re-tessellate the paths.
    let lastSig = '';
    let lastSetSig = '';
    const tick = () => {
      if (document.hidden) return; // hidden tab: skip work, resume on visibility
      const { flights: fl, selectedFlightId, homeAirports: homes } = useFlightsStore.getState();
      const ft = useFiltersStore.getState();
      const q = getRenderQueueMemo(fl, ft);
      const set = [...q.mainQueue, ...q.dnsQueue];
      let sig = `${selectedFlightId ?? ''}|${ft.trailStyle}|${ft.aggregate}|${homes.length}`;
      for (const f of set) {
        sig += `|${f.id},${f.phase},${liveProgress(f).toFixed(3)},${f.liveryColor},${f.isLan ? 1 : 0},${f.country},${trailWidth(f.bytesPerSec, f.id === selectedFlightId)}`;
      }
      if (sig !== lastSig) {
        lastSig = sig;
        const trails: TrailDatum[] = set.filter(
          (f) => !f.isLan && (f.phase === 'cruise' || f.phase === 'hold' || f.phase === 'descent'),
        );
        // Selected flight: append its remaining route as a dotted path entry.
        const sel = selectedFlightId ? trails.find((f) => f.id === selectedFlightId) : undefined;
        if (sel && liveProgress(sel) < 1) trails.push({ ...sel, __remaining: true });
        setTrailData(trails);
        const m = new Map<string, DestDot>();
        for (const f of set) {
          const e = m.get(f.country);
          if (e) e.count++;
          else m.set(f.country, { country: f.country, lat: f.dstLat, lng: f.dstLng, count: 1 });
        }
        setDestData([...m.values()]);
        setRouteData(ft.aggregate ? aggregateRoutes(set, homes) : []);
      }
      // Housekeeping only when the flight set or its liveries changed (not
      // every 90ms): free unused materials, and drop mesh-registry entries for
      // flights three-globe removed (it disposes the Object3D; we drop the ref).
      let setSig = '';
      for (const f of fl) setSig += `${f.id}:${f.liveryColor},`;
      if (setSig !== lastSetSig) {
        lastSetSig = setSig;
        disposeUnusedMaterials(new Set(fl.map((f) => f.liveryColor)));
        const liveIds = new Set(renderedRef.current.map((f) => f.id));
        for (const k of meshById.current.keys()) if (!liveIds.has(k)) meshById.current.delete(k);
      }
    };
    const id = setInterval(tick, 90);
    tick();
    return () => clearInterval(id);
  }, []);

  // ── identity-stable accessors ──────────────────────────────────────────
  const isVpn = useCallback((f: Flight) => !!homeById(f.homeAirportId)?.isVpn, [homeById]);

  const pathPoints = useCallback(
    (d: object): [number, number, number][] => {
      const f = asF(d);
      const ep = flightEndpoints(homeById(f.homeAirportId), f);
      const baseAlt = arcAltitude(greatCircleKm(ep.startLat, ep.startLng, ep.endLat, ep.endLng));
      if ((d as TrailDatum).__remaining) {
        // Remaining (estimated) route: fixed sample count from the plane's
        // current position to the destination, following the arc altitude.
        const prog = Math.min(1, liveProgress(f));
        const out: [number, number, number][] = [];
        for (let i = 0; i <= REMAIN_STEPS; i++) {
          const t = prog + (1 - prog) * (i / REMAIN_STEPS);
          const p = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, t);
          out.push([p.lat, p.lng, baseAlt * Math.sin(t * Math.PI) + 0.004]);
        }
        return out;
      }
      const steps = f.id === selRef.current ? TRAIL_STEPS_SEL : TRAIL_STEPS;
      const pts = arcPoints(ep.startLat, ep.startLng, ep.endLat, ep.endLng, f.arcProgress, steps);
      const n = pts.length;
      return pts.map((pt, i) => {
        const alt = baseAlt * Math.sin(((i / (n - 1)) * f.arcProgress) * Math.PI) + 0.004;
        return [pt[1], pt[0], alt];
      });
    },
    [homeById],
  );
  const pathColor = useCallback((d: object): string[] => {
    const f = asF(d);
    if ((d as TrailDatum).__remaining) {
      return new Array<string>(REMAIN_STEPS + 1).fill(rgba(f.liveryColor, 0.35));
    }
    const steps = f.id === selRef.current ? TRAIL_STEPS_SEL : TRAIL_STEPS;
    return trailPathColors(f.liveryColor, steps, f.arcProgress, useFiltersStore.getState().trailStyle);
  }, []);
  const pathDashLength = useCallback(
    (d: object) => ((d as TrailDatum).__remaining ? 0.05 : isVpn(asF(d)) ? 0.5 : 1),
    [isVpn],
  );
  const pathDashGap = useCallback(
    (d: object) => ((d as TrailDatum).__remaining ? 0.04 : isVpn(asF(d)) ? 0.3 : 0),
    [isVpn],
  );


  // Destination beacon: a livery-colored ring pulse at the selected flight's
  // destination. Memoized on scalars so the ring datum keeps its identity
  // across 10Hz store pushes (a new object would restart the pulse animation).
  const selFlight = selectedId ? flights.find((x) => x.id === selectedId) : undefined;
  const destLat = selFlight?.dstLat;
  const destLng = selFlight?.dstLng;
  const destColor = selFlight?.liveryColor;
  const showDestRing = !!selFlight && !selFlight.isLan && selFlight.geoConfidence !== 'none';
  const ringData = useMemo(() => {
    if (!showDestRing || destLat === undefined || destLng === undefined) return homeAirports;
    const dest = {
      id: '__dest',
      label: '',
      lat: destLat,
      lng: destLng,
      ip: '',
      isVpn: false,
      __color: destColor,
    };
    return [...homeAirports, dest];
  }, [homeAirports, showDestRing, destLat, destLng, destColor]);


  const customThreeObject = useCallback((d: object) => {
    const f = asF(d);
    const mesh = createPlaneMesh(f);
    mesh.userData.flightId = f.id;
    meshById.current.set(f.id, mesh);
    return mesh;
  }, []);

  // Driven every frame by the rAF ticker (with arcProgressLive) and once on
  // data change by customThreeObjectUpdate, so a new mesh isn't a frame late.
  const updateMesh = useCallback(
    (o: THREE.Object3D, f: Flight, g: GlobeApi, now: number, progress: number) =>
      positionPlaneMesh(o, f, homeById(f.homeAirportId), g, now, progress, {
        selected: f.id === selRef.current,
        far: farRef.current,
      }),
    [homeById],
  );

  const customThreeObjectUpdate = useCallback(
    (obj: object, d: object) => {
      const g = globe.current as unknown as GlobeApi | null;
      if (!g) return;
      const f = asF(d);
      updateMesh(obj as THREE.Object3D, f, g, performance.now(), liveProgress(f));
    },
    [updateMesh],
  );

  // Per-frame mesh ticker — runs every frame regardless of the 10Hz store so the
  // fleet animates smoothly. Reads arcProgressLive (the animation channel).
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      try {
        const g = globe.current as unknown as GlobeApi | null;
        if (g) {
          const now = performance.now();
          const cp = g.camera().position;
          farRef.current = Math.hypot(cp.x, cp.y, cp.z) > LOD_FAR_DIST;
          const meshes = meshById.current;
          for (const f of renderedRef.current) {
            const o = meshes.get(f.id);
            if (o) updateMesh(o, f, g, now, liveProgress(f));
          }
        }
      } finally {
        raf = requestAnimationFrame(frame); // one bad frame must not stop the globe
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      hideTip();
    };
  }, [updateMesh]);

  const findFlightAt = useCallback(
    (x: number, y: number, radiusPx: number): Flight | null => {
      const g = globe.current as unknown as GlobeApi | null;
      return g ? pickFlightAt(g, renderedRef.current, homeById, x, y, radiusPx, performance.now()) : null;
    },
    [homeById],
  );

  // Hover tooltip + pointer cursor (throttled ~30Hz).
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTip = useRef(0);
  const onTipMove = useCallback(
    (e: React.PointerEvent) => {
      const now = performance.now();
      if (now - lastTip.current < 33) return;
      lastTip.current = now;
      const best = findFlightAt(e.clientX, e.clientY, 14);
      if (containerRef.current) containerRef.current.style.cursor = best ? 'pointer' : '';
      if (best) showTip(e.clientX, e.clientY, flightTipText(best));
      else hideTip();
    },
    [findFlightAt],
  );

  // Click-to-select: a pointerup that didn't drag selects the nearest plane;
  // clicking empty globe clears the selection (parity with the 2D map).
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = downPos.current;
      downPos.current = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // drag, not a click
      const f = findFlightAt(e.clientX, e.clientY, 18);
      useFlightsStore.getState().selectFlight(f ? f.id : null);
    },
    [findFlightAt],
  );

  // Lights, initial camera, auto-rotate. Refs only, so the callback is stable.
  const onGlobeReady = useCallback(() => {
    const g = globe.current;
    if (!g) return;
    const scene = g.scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(1, 1, 1);
    scene.add(dir);
    const primary = homeRef.current.find((a) => a.id === 'primary') ?? homeRef.current[0];
    // Always set the plane-visible default altitude — home may not have
    // arrived yet; the homeAirports effect re-centers when it does.
    g.pointOfView(
      { lat: primary?.lat ?? 30, lng: primary?.lng ?? 15, altitude: DEFAULT_ALT },
      0,
    );
    if (primary) homePointedRef.current = true;
    const c = g.controls() as {
      autoRotate: boolean;
      autoRotateSpeed: number;
      addEventListener: (e: string, cb: () => void) => void;
    };
    c.autoRotate = !reducedMotion();
    c.autoRotateSpeed = 0.15;
    c.addEventListener('start', () => {
      userMovedRef.current = true;
      c.autoRotate = false;
      clearTimeout(idleTimer.current);
    });
    c.addEventListener('end', () => {
      idleTimer.current = window.setTimeout(() => {
        if (!useFlightsStore.getState().selectedFlightId && !reducedMotion()) c.autoRotate = true;
      }, 2500);
    });
    rendererRef.current = g.renderer() as unknown as { forceContextLoss(): void };
  }, []);

  // react-globe.gl disposes the renderer on unmount but doesn't release the
  // WebGL context; without this, 2D↔3D toggling piles up contexts until the
  // browser starts dropping the oldest.
  useEffect(
    () => () => {
      clearTimeout(idleTimer.current);
      rendererRef.current?.forceContextLoss();
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onPointerMove={onTipMove}
      onPointerLeave={hideTip}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <Globe
        ref={globe}
        width={size.w}
        height={size.h}
        globeImageUrl={null}
        globeMaterial={globeMaterial}
        backgroundImageUrl="/textures/night-sky-dim.jpg" /* dimmed so planes, not stars, catch the eye */
        backgroundColor="#000000"
        atmosphereColor={theme.atmosphere}
        atmosphereAltitude={theme.atmosphereAlt ?? 0.16}
        /* themed globe — country border strokes over the recolored terrain */
        polygonsData={polygonsData}
        polygonCapColor={polygonCapColorFn}
        polygonSideColor={polygonSideColorFn}
        polygonStrokeColor={polygonStrokeColorFn}
        polygonAltitude={0.006}
        polygonsTransitionDuration={0}
        onZoom={onZoom}
        onGlobeReady={onGlobeReady}
        /* trails (throttled) — VPN dashed */
        pathsData={aggregate ? NO_ITEMS : trailData}
        pathPoints={pathPoints}
        pathPointAlt={pathPointAlt}
        pathColor={pathColor}
        pathStroke={pathStroke}
        pathDashLength={pathDashLength}
        pathDashGap={pathDashGap}
        pathTransitionDuration={0}
        /* grouped view: one animated arc per home → country route */
        arcsData={routeData}
        arcStartLat={arcStartLat}
        arcStartLng={arcStartLng}
        arcEndLat={arcEndLat}
        arcEndLng={arcEndLng}
        arcColor={arcColor}
        arcStroke={arcStroke}
        arcAltitudeAutoScale={0.25}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={reducedMotion() ? 0 : 2000}
        arcsTransitionDuration={0}
        /* home airports + destination beacon (selected flight) */
        ringsData={ringData}
        ringLat={ringLat}
        ringLng={ringLng}
        ringColor={ringColor}
        ringMaxRadius={3}
        ringPropagationSpeed={2}
        ringRepeatPeriod={ringRepeatPeriod}
        labelsData={homeAirports}
        labelLat={ringLat}
        labelLng={ringLng}
        labelText={labelText}
        labelColor={labelColor}
        labelSize={0.85}
        labelDotRadius={0.28}
        labelResolution={1}
        /* clickable destination dots (throttled) */
        pointsData={destData}
        pointLat={pointLat}
        pointLng={pointLng}
        pointColor={pointColor}
        pointAltitude={0.005}
        pointRadius={pointRadius}
        onPointClick={onPointClick}
        /* plane meshes (every frame) */
        customLayerData={aggregate ? NO_ITEMS : rendered}
        customThreeObject={customThreeObject}
        customThreeObjectUpdate={customThreeObjectUpdate}
      />
      {!aggregate && <LeaderLine w={size.w} h={size.h} />}
    </div>
  );
}
