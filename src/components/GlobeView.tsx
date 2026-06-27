import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { getRenderQueue } from '@/lib/render-queue';
import { flightEndpoints } from '@/lib/arc';
import { interpolateArc, arcPoints, greatCircleKm, arcAltitude } from '@/lib/interpolate';
import { createPlaneMesh, setPlaneSelected, disposeUnusedMaterials } from '@/lib/globe-meshes';
import { globeRef as sharedGlobeRef, type GlobeApi } from '@/lib/view-refs';
import type { Flight, HomeAirport } from '@/types';

const asF = (d: object) => d as Flight;
const TRAIL_STEPS = 16;
const GLOBE_R = 100;

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a.toFixed(3)})`;
}

interface DestDot {
  country: string;
  lat: number;
  lng: number;
  count: number;
}

// Per-frame scratch — never allocate inside the mesh-update loop.
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _right = new THREE.Vector3();
const _m = new THREE.Matrix4();

export default function GlobeView() {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const flights = useFlightsStore((s) => s.flights);
  const homeAirports = useFlightsStore((s) => s.homeAirports);
  const selectedId = useFlightsStore((s) => s.selectedFlightId);
  const filters = useFiltersStore();
  const cardMode = useFiltersStore((s) => s.cardAnchor3d);
  const idleTimer = useRef<number | undefined>(undefined);

  // Refs so accessors below can be identity-stable (never trigger layer rebuilds).
  const homeRef = useRef(homeAirports);
  homeRef.current = homeAirports;
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  const homeById = useCallback(
    (id: string): HomeAirport | undefined => homeRef.current.find((a) => a.id === id),
    [],
  );

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

  useEffect(() => {
    const c = globe.current?.controls() as { autoRotate: boolean } | undefined;
    if (c) c.autoRotate = !selectedId;
  }, [selectedId]);

  // Plane meshes update every frame (cheap). Trails + dots are throttled to
  // ~11fps via state so their geometry doesn't rebuild 60×/sec.
  const { mainQueue, dnsQueue } = useMemo(
    () => getRenderQueue(flights, filters),
    [flights, filters],
  );
  const rendered = useMemo(() => [...mainQueue, ...dnsQueue], [mainQueue, dnsQueue]);

  const [trailData, setTrailData] = useState<Flight[]>([]);
  const [destData, setDestData] = useState<DestDot[]>([]);
  useEffect(() => {
    const tick = () => {
      const fl = useFlightsStore.getState().flights;
      const ft = useFiltersStore.getState();
      const q = getRenderQueue(fl, ft);
      const set = [...q.mainQueue, ...q.dnsQueue];
      setTrailData(
        set.filter((f) => f.phase === 'cruise' || f.phase === 'hold' || f.phase === 'descent'),
      );
      const m = new Map<string, DestDot>();
      for (const f of set) {
        const e = m.get(f.country);
        if (e) e.count++;
        else m.set(f.country, { country: f.country, lat: f.dstLat, lng: f.dstLng, count: 1 });
      }
      setDestData([...m.values()]);
      disposeUnusedMaterials(new Set(fl.map((f) => f.liveryColor)));
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
      const pts = arcPoints(ep.startLat, ep.startLng, ep.endLat, ep.endLng, f.arcProgress, TRAIL_STEPS);
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
    const n = TRAIL_STEPS + 1;
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(rgba(f.liveryColor, (i / (n - 1)) * 0.9));
    return out;
  }, []);
  const pathPointAlt = useCallback((p: unknown) => (p as number[])[2], []);
  const pathDashLength = useCallback((d: object) => (isVpn(asF(d)) ? 0.5 : 1), [isVpn]);
  const pathDashGap = useCallback((d: object) => (isVpn(asF(d)) ? 0.3 : 0), [isVpn]);

  const ringLat = useCallback((d: object) => (d as HomeAirport).lat, []);
  const ringLng = useCallback((d: object) => (d as HomeAirport).lng, []);
  const ringColor = useCallback(
    (d: object) => () => ((d as HomeAirport).isVpn ? '#8b5cf6' : '#ffffff'),
    [],
  );
  const labelText = useCallback((d: object) => (d as HomeAirport).label, []);
  const labelColor = useCallback(
    (d: object) => ((d as HomeAirport).isVpn ? '#8b5cf6' : '#ffffff'),
    [],
  );

  const pointLat = useCallback((d: object) => (d as DestDot).lat, []);
  const pointLng = useCallback((d: object) => (d as DestDot).lng, []);
  const pointRadius = useCallback((d: object) => 0.18 + Math.min(0.35, (d as DestDot).count * 0.03), []);
  const onPointClick = useCallback(
    (d: object) => useFiltersStore.getState().setIsolatedCountry((d as DestDot).country),
    [],
  );

  const customThreeObject = useCallback((d: object) => createPlaneMesh(asF(d)), []);
  const customThreeObjectUpdate = useCallback(
    (obj: object, d: object) => {
      const o = obj as THREE.Object3D;
      const f = asF(d);
      const g = globe.current as unknown as GlobeApi | null;
      if (!g) return;
      const ep = flightEndpoints(homeById(f.homeAirportId), f);
      const p = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, f.arcProgress);
      const km = greatCircleKm(ep.startLat, ep.startLng, ep.endLat, ep.endLng);
      const alt = arcAltitude(km) * Math.sin(f.arcProgress * Math.PI) + 0.006;
      const c = g.getCoords(p.lat, p.lng, alt);
      _pos.set(c.x, c.y, c.z);
      o.position.copy(_pos);
      _up.copy(_pos).normalize();
      const np = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, Math.min(1, f.arcProgress + 0.01));
      const nc = g.getCoords(np.lat, np.lng, alt);
      _fwd.set(nc.x, nc.y, nc.z).sub(_pos);
      _proj.copy(_up).multiplyScalar(_fwd.dot(_up));
      _fwd.sub(_proj);
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
      _fwd.normalize();
      _right.crossVectors(_up, _fwd).normalize();
      _m.makeBasis(_right, _up, _fwd);
      o.quaternion.setFromRotationMatrix(_m);
      setPlaneSelected(o, f.id === selRef.current);
    },
    [homeById],
  );

  // Leader line from the selected plane to the docked card (screen space).
  let leader: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (selectedId && cardMode === 'docked' && globe.current) {
    const f = flights.find((x) => x.id === selectedId);
    const g = globe.current as unknown as GlobeApi;
    if (f) {
      const ep = flightEndpoints(homeById(f.homeAirportId), f);
      const p = interpolateArc(ep.startLat, ep.startLng, ep.endLat, ep.endLng, f.arcProgress);
      const sc = g.getScreenCoords(p.lat, p.lng, 0.02);
      let visible = true;
      try {
        const P = g.getCoords(p.lat, p.lng, 0);
        const C = g.camera().position;
        visible = P.x * C.x + P.y * C.y + P.z * C.z > GLOBE_R * GLOBE_R;
      } catch {
        /* keep */
      }
      if (visible) leader = { x1: sc.x, y1: sc.y, x2: size.w - 336, y2: size.h - 150 };
    }
  }

  return (
    <div className="absolute inset-0">
      <Globe
        ref={globe}
        width={size.w}
        height={size.h}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        backgroundColor="#000000"
        atmosphereColor="#3a82ff"
        atmosphereAltitude={0.16}
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
          c.autoRotate = true;
          c.autoRotateSpeed = 0.35;
          c.addEventListener('start', () => {
            c.autoRotate = false;
            clearTimeout(idleTimer.current);
          });
          c.addEventListener('end', () => {
            idleTimer.current = window.setTimeout(() => {
              if (!useFlightsStore.getState().selectedFlightId) c.autoRotate = true;
            }, 2500);
          });
        }}
        /* trails (throttled) — VPN dashed */
        pathsData={trailData}
        pathPoints={pathPoints}
        pathPointAlt={pathPointAlt}
        pathColor={pathColor}
        pathStroke={1.6}
        pathDashLength={pathDashLength}
        pathDashGap={pathDashGap}
        pathTransitionDuration={0}
        /* home airports */
        ringsData={homeAirports}
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
      {leader && (
        <svg className="pointer-events-none absolute inset-0 z-20" width={size.w} height={size.h}>
          <line
            x1={leader.x1}
            y1={leader.y1}
            x2={leader.x2}
            y2={leader.y2}
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <circle cx={leader.x1} cy={leader.y1} r={3} fill="none" stroke="rgba(255,255,255,0.7)" />
        </svg>
      )}
    </div>
  );
}
