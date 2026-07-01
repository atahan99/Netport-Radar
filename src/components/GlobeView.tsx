import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { getRenderQueueMemo } from '@/lib/render-queue';
import { flightEndpoints } from '@/lib/arc';
import {
  globeBorderColor,
  useVectorPolygons,
  polygonCapColor,
  polygonSideColor,
  polygonStrokeColor,
  homeRingColor,
  rgba,
} from '@/lib/globe-color';
import { globeMaterialFor } from '@/lib/globe-material';
import { correctedLngOffset, orientPlaneMesh } from '@/lib/mesh-orientation';
import { interpolateArc, arcPoints, greatCircleKm, arcAltitude } from '@/lib/interpolate';
import {
  createPlaneMesh,
  setPlaneSelected,
  setPlaneLOD,
  recolorPlane,
  disposeUnusedMaterials,
  triggerLandingFlare,
  updateLandingFlare,
  updateStrobes,
} from '@/lib/globe-meshes';
import { trailPathColors } from '@/lib/trail-color';
import { lifecyclePose } from '@/lib/lifecycle';
import { liveProgress } from '@/lib/anim';
import { reducedMotion } from '@/lib/motion';
import { showTip, hideTip, flightTipText } from '@/lib/tooltip';
import { THEME_BY_ID } from '@/lib/themes';
import { globeRef as sharedGlobeRef, type GlobeApi } from '@/lib/view-refs';
import LeaderLine from '@/components/LeaderLine';
import type { Flight, HomeAirport } from '@/types';

const asF = (d: object) => d as Flight;
const TRAIL_STEPS = 16;
const TRAIL_STEPS_SEL = 32; // higher resolution for the selected flight
const REMAIN_STEPS = 24; // remaining-route samples (selected flight only)
const BANK_RAD = 0.45; // bank angle while circling (hold / LAN orbit)
// LOD: beyond this camera distance from the globe center (radius 100), planes
// render as dots instead of detailed silhouettes. ~altitude 1.8 in globe units.
const LOD_FAR_DIST = 280;

// Trail entry: a flight, or the selected flight's remaining (estimated) route.
type TrailDatum = Flight & { __remaining?: boolean };

// Stable empty list so react-globe.gl doesn't rebuild polygons every render when
// the theme has no country layer (Midnight / Satellite keep the photo earth).
const NO_POLYGONS: object[] = [];

interface DestDot {
  country: string;
  lat: number;
  lng: number;
  count: number;
}

// Per-frame scratch — never allocate inside the mesh-update loop.
const _pos = new THREE.Vector3();
const _fwdHint = new THREE.Vector3();

export default function GlobeView() {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const flights = useFlightsStore((s) => s.flights);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const filters = useFiltersStore();
  const themeId = useFiltersStore((s) => s.theme);
  const theme = THEME_BY_ID[themeId];
  const idleTimer = useRef<number | undefined>(undefined);

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
  const polygonCapColorFn = useCallback(() => polygonCapColor(), []);
  const polygonStrokeColorFn = useCallback(() => polygonStrokeColor(borderColor), [borderColor]);
  const polygonSideColorFn = useCallback(() => polygonSideColor(), []);
  const polygonsData = useVectorPolygons(theme) ? countries : NO_POLYGONS;

  useEffect(() => {
    const c = globe.current?.controls() as { autoRotate: boolean } | undefined;
    if (c) c.autoRotate = !selectedId && !reducedMotion();
  }, [selectedId]);

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
  useEffect(() => {
    const tick = () => {
      const { flights: fl, selectedFlightId } = useFlightsStore.getState();
      const ft = useFiltersStore.getState();
      const q = getRenderQueueMemo(fl, ft);
      const set = [...q.mainQueue, ...q.dnsQueue];
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
      disposeUnusedMaterials(new Set(fl.map((f) => f.liveryColor)));
      // Drop mesh-registry entries for flights three-globe has removed from the
      // custom layer (it disposes the Object3D; we just release our reference).
      const liveIds = new Set(renderedRef.current.map((f) => f.id));
      for (const k of meshById.current.keys()) if (!liveIds.has(k)) meshById.current.delete(k);
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
  const pathPointAlt = useCallback((p: unknown) => (p as number[])[2], []);
  const pathStroke = useCallback((d: object) => ((d as TrailDatum).__remaining ? 1.1 : 1.6), []);
  const pathDashLength = useCallback(
    (d: object) => ((d as TrailDatum).__remaining ? 0.05 : isVpn(asF(d)) ? 0.5 : 1),
    [isVpn],
  );
  const pathDashGap = useCallback(
    (d: object) => ((d as TrailDatum).__remaining ? 0.04 : isVpn(asF(d)) ? 0.3 : 0),
    [isVpn],
  );

  const ringLat = useCallback((d: object) => (d as HomeAirport).lat, []);
  const ringLng = useCallback((d: object) => (d as HomeAirport).lng, []);
  const ringColor = useCallback(
    (d: object) => () =>
      (d as { __color?: string }).__color ?? homeRingColor((d as HomeAirport).isVpn),
    [],
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
  const labelText = useCallback((d: object) => (d as HomeAirport).label, []);
  const labelColor = useCallback(
    (d: object) => homeRingColor((d as HomeAirport).isVpn),
    [],
  );

  const pointLat = useCallback((d: object) => (d as DestDot).lat, []);
  const pointLng = useCallback((d: object) => (d as DestDot).lng, []);
  const pointRadius = useCallback((d: object) => 0.18 + Math.min(0.35, (d as DestDot).count * 0.03), []);
  const onPointClick = useCallback(
    (d: object) => useFiltersStore.getState().setIsolatedCountry((d as DestDot).country),
    [],
  );

  const customThreeObject = useCallback((d: object) => {
    const f = asF(d);
    const mesh = createPlaneMesh(f);
    mesh.userData.flightId = f.id;
    meshById.current.set(f.id, mesh);
    return mesh;
  }, []);

  // Position/orient/scale/flare a plane mesh for `progress` along its arc. Driven
  // every frame by the rAF ticker (with arcProgressLive) and once on data-change
  // by customThreeObjectUpdate (so a freshly-created mesh isn't a frame late).
  const updateMesh = useCallback(
    (o: THREE.Object3D, f: Flight, g: GlobeApi, now: number, progress: number) => {
      const home = homeById(f.homeAirportId);
      const ep = flightEndpoints(home, f);
      // LAN flights orbit home (pinned), never fly out to a destination.
      const p =
        f.isLan && home
          ? { lat: home.lat, lng: home.lng, heading: 0 }
          : interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, progress);
      const km = f.isLan ? 0 : greatCircleKm(ep.startLat, ep.startLng, ep.endLat, ep.endLng);
      const alt = f.isLan ? 0.03 : arcAltitude(km) * Math.sin(progress * Math.PI) + 0.006;
      const pose = lifecyclePose(f, now);
      const oLat = pose.dLat;
      const oLng = correctedLngOffset(pose.dLng, p.lat);
      const c = g.getCoords(p.lat + oLat, p.lng + oLng, alt);
      _pos.set(c.x, c.y, c.z);
      o.position.copy(_pos);
      // Forward hint uses the pose slightly in the future so orbiting planes
      // (hold circles / LAN) face along their actual motion, not just the arc.
      const np = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, Math.min(1, progress + 0.01));
      const pose2 = lifecyclePose(f, now + 130);
      const nc = g.getCoords(
        np.lat + pose2.dLat,
        np.lng + correctedLngOffset(pose2.dLng, p.lat),
        alt,
      );
      _fwdHint.set(nc.x, nc.y, nc.z);
      // Bank into the turn while circling (hold / LAN orbit).
      const banking = !reducedMotion() && (f.phase === 'hold' || (f.isLan && f.phase !== 'landed'));
      orientPlaneMesh(_pos, _fwdHint, o.quaternion, banking ? BANK_RAD : 0);
      setPlaneSelected(o, f.id === selRef.current);
      // Taxi spool / landed shrink layers on top of the selection scale.
      o.scale.multiplyScalar(pose.scale);
      recolorPlane(o, f.liveryColor, f.aircraftType);
      // One-shot landing flare on touchdown (descent → landed).
      if (o.userData.phase !== f.phase) {
        if (f.phase === 'landed' && o.userData.phase && !reducedMotion()) triggerLandingFlare(o, now);
        o.userData.phase = f.phase;
      }
      updateLandingFlare(o, now);
      setPlaneLOD(o, farRef.current);
      updateStrobes(o, now, !reducedMotion() && !farRef.current && f.phase !== 'landed');
    },
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
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      hideTip();
    };
  }, [updateMesh]);

  // Nearest rendered flight within `radiusPx` of a screen point, by projecting
  // each flight's arc position (same approach as the tooltip — no raycasting,
  // and a generous FR24-style hit radius since the planes are small).
  const findFlightAt = useCallback(
    (x: number, y: number, radiusPx: number): Flight | null => {
      const g = globe.current as unknown as GlobeApi | null;
      if (!g) return null;
      let best: Flight | null = null;
      let bestD = radiusPx * radiusPx;
      for (const f of renderedRef.current) {
        const ep = flightEndpoints(homeById(f.homeAirportId), f);
        const p = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, liveProgress(f));
        const sc = g.getScreenCoords(p.lat, p.lng, 0.02);
        const dx = sc.x - x;
        const dy = sc.y - y;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) {
          bestD = dd;
          best = f;
        }
      }
      return best;
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
      const best = findFlightAt(e.clientX, e.clientY, 12);
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
      const f = findFlightAt(e.clientX, e.clientY, 14);
      useFlightsStore.getState().selectFlight(f ? f.id : null);
    },
    [findFlightAt],
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
        backgroundImageUrl="/textures/night-sky.png"
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
        onGlobeReady={() => {
          const g = globe.current;
          if (!g) return;
          const scene = g.scene();
          scene.add(new THREE.AmbientLight(0xffffff, 0.7));
          const dir = new THREE.DirectionalLight(0xffffff, 0.85);
          dir.position.set(1, 1, 1);
          scene.add(dir);
          const primary = homeRef.current.find((a) => a.id === 'primary') ?? homeRef.current[0];
          if (primary) g.pointOfView({ lat: primary.lat, lng: primary.lng, altitude: 2.3 }, 0);
          const c = g.controls() as {
            autoRotate: boolean;
            autoRotateSpeed: number;
            addEventListener: (e: string, cb: () => void) => void;
          };
          c.autoRotate = !reducedMotion();
          c.autoRotateSpeed = 0.35;
          c.addEventListener('start', () => {
            c.autoRotate = false;
            clearTimeout(idleTimer.current);
          });
          c.addEventListener('end', () => {
            idleTimer.current = window.setTimeout(() => {
              if (!useFlightsStore.getState().selectedFlightId && !reducedMotion()) c.autoRotate = true;
            }, 2500);
          });
        }}
        /* trails (throttled) — VPN dashed */
        pathsData={trailData}
        pathPoints={pathPoints}
        pathPointAlt={pathPointAlt}
        pathColor={pathColor}
        pathStroke={pathStroke}
        pathDashLength={pathDashLength}
        pathDashGap={pathDashGap}
        pathTransitionDuration={0}
        /* home airports + destination beacon (selected flight) */
        ringsData={ringData}
        ringLat={ringLat}
        ringLng={ringLng}
        ringColor={ringColor}
        ringMaxRadius={3}
        ringPropagationSpeed={2}
        ringRepeatPeriod={900}
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
        pointColor={() => 'rgba(255,255,255,0.55)'}
        pointAltitude={0.005}
        pointRadius={pointRadius}
        onPointClick={onPointClick}
        /* plane meshes (every frame) */
        customLayerData={rendered}
        customThreeObject={customThreeObject}
        customThreeObjectUpdate={customThreeObjectUpdate}
      />
      <LeaderLine w={size.w} h={size.h} />
    </div>
  );
}
