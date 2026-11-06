// src/lib/globe-meshes.ts
// Three.js plane meshes for the globe. One THREE.Group per aircraft type,
// built nose-along +Z, up +Y. Each type is assembled from primitives (tapered
// fuselage cylinders, extruded wing shapes, nacelles) and merged into a single
// BufferGeometry, cached per type; materials are cached per color, so the
// 150-plane fleet shares a handful of GPU resources. A shared halo ring child
// marks the selected plane; wingtip nav strobes blink on airliner types.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Flight, AircraftType } from '@/types';

// Globe radius in three-globe scene units is 100; size meshes relative to that.
const GLOBE_MESH_BASE = 3.2;

const TYPE_SCALE: Record<AircraftType, number> = {
  widebody: 1,
  narrowbody: 0.85,
  cargo: 1.7,
  helicopter: 0.75,
  privatejet: 0.8,
  satellite: 1.1,
  drone: 0.45,
  ambulance: 0.65,
  stealth: 0.9,
  broadcast: 1,
};

const geoCache = new Map<AircraftType, THREE.BufferGeometry[]>();
const matCache = new Map<string, THREE.Material>();

let haloGeo: THREE.BufferGeometry | null = null;
let haloMat: THREE.Material | null = null;

// ── primitive builders (all bake their transform into the geometry) ────────

function box(
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
  ry = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// Cylinder along +Z (nose axis): rFront faces +Z, rBack faces −Z.
function tube(
  rFront: number,
  rBack: number,
  len: number,
  x = 0,
  y = 0,
  z = 0,
  radial = 10,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rFront, rBack, len, radial);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// Horizontal rotor / rotodome disc (axis +Y).
function disc(r: number, th: number, x = 0, y = 0, z = 0, radial = 20): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, th, radial);
  g.translate(x, y, z);
  return g;
}

// Flat lifting surface extruded from a top-down outline. Points are [x, z]
// (span, fore/aft with +z toward the nose); thickness is along Y.
function wing(pts: Array<[number, number]>, thick: number, y = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  // Shape XY → world XZ (y becomes z), extrusion depth becomes Y thickness.
  g.rotateX(Math.PI / 2);
  g.translate(0, y + thick / 2, 0);
  return g;
}

function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  return merged;
}

// ── per-type silhouettes ────────────────────────────────────────────────────

function buildGeometries(type: AircraftType): THREE.BufferGeometry[] {
  switch (type) {
    case 'widebody':
      return [
        merge([
          tube(0.015, 0.075, 0.16, 0, 0, 0.42), // nose cone
          tube(0.075, 0.075, 0.62, 0, 0, 0.03), // cabin tube
          tube(0.075, 0.02, 0.22, 0, 0, -0.39), // tail cone
          wing([[-0.56, -0.24], [0, 0.16], [0.56, -0.24], [0.56, -0.34], [0, -0.1], [-0.56, -0.34]], 0.03, -0.02),
          wing([[-0.22, -0.5], [0, -0.36], [0.22, -0.5], [0.22, -0.56], [0, -0.44], [-0.22, -0.56]], 0.022),
          box(0.022, 0.2, 0.16, 0, 0.12, -0.44), // fin
          tube(0.035, 0.035, 0.14, 0.2, -0.05, 0.08), // nacelles
          tube(0.035, 0.035, 0.14, -0.2, -0.05, 0.08),
        ]),
      ];
    case 'narrowbody':
      return [
        merge([
          tube(0.012, 0.06, 0.14, 0, 0, 0.38),
          tube(0.06, 0.06, 0.55, 0, 0, 0.035),
          tube(0.06, 0.016, 0.18, 0, 0, -0.33),
          wing([[-0.42, -0.18], [0, 0.12], [0.42, -0.18], [0.42, -0.26], [0, -0.08], [-0.42, -0.26]], 0.025, -0.015),
          wing([[-0.16, -0.4], [0, -0.3], [0.16, -0.4], [0.16, -0.45], [0, -0.36], [-0.16, -0.45]], 0.02),
          box(0.02, 0.15, 0.12, 0, 0.09, -0.36),
          tube(0.028, 0.028, 0.11, 0.15, -0.042, 0.05),
          tube(0.028, 0.028, 0.11, -0.15, -0.042, 0.05),
        ]),
      ];
    case 'cargo':
      return [
        merge([
          tube(0.03, 0.1, 0.16, 0, 0, 0.4), // blunt nose
          tube(0.1, 0.1, 0.64, 0, 0, 0),
          tube(0.1, 0.028, 0.18, 0, 0, -0.41),
          wing([[-0.52, -0.16], [0, 0.14], [0.52, -0.16], [0.52, -0.28], [0, -0.12], [-0.52, -0.28]], 0.032, 0.06), // high wing
          wing([[-0.26, -0.48], [0, -0.36], [0.26, -0.48], [0.26, -0.56], [0, -0.46], [-0.26, -0.56]], 0.025),
          box(0.025, 0.26, 0.18, 0, 0.16, -0.42),
          tube(0.045, 0.045, 0.16, 0.22, 0, 0.1),
          tube(0.045, 0.045, 0.16, -0.22, 0, 0.1),
        ]),
      ];
    case 'helicopter':
      return [
        merge([
          tube(0.02, 0.1, 0.12, 0, 0, 0.25), // canopy nose
          tube(0.1, 0.1, 0.28, 0, 0, 0.05), // cabin
          tube(0.1, 0.02, 0.14, 0, 0, -0.14), // cabin taper
          tube(0.02, 0.012, 0.4, 0, 0.02, -0.38), // tail boom
          box(0.03, 0.06, 0.03, 0, 0.1, 0.02), // rotor mast
          disc(0.48, 0.012, 0, 0.16, 0.02, 24), // main rotor
          disc(0.09, 0.01, 0, 0, 0, 12).rotateZ(Math.PI / 2).translate(0.03, 0.05, -0.56), // tail rotor
          box(0.02, 0.02, 0.4, 0.09, -0.11, 0.05), // skids
          box(0.02, 0.02, 0.4, -0.09, -0.11, 0.05),
        ]),
      ];
    case 'privatejet':
      return [
        merge([
          tube(0.01, 0.048, 0.16, 0, 0, 0.375),
          tube(0.048, 0.048, 0.55, 0, 0, 0.02),
          tube(0.048, 0.014, 0.16, 0, 0, -0.335),
          wing([[-0.38, -0.3], [0, 0.02], [0.38, -0.3], [0.38, -0.38], [0, -0.1], [-0.38, -0.38]], 0.022, -0.01),
          tube(0.03, 0.03, 0.11, 0.085, 0.03, -0.26), // rear-mounted engines
          tube(0.03, 0.03, 0.11, -0.085, 0.03, -0.26),
          box(0.018, 0.16, 0.11, 0, 0.1, -0.37), // fin
          wing([[-0.15, -0.4], [0, -0.32], [0.15, -0.4], [0.15, -0.45], [0, -0.38], [-0.15, -0.45]], 0.018, 0.17), // T-tail
        ]),
      ];
    case 'satellite':
      return [
        merge([
          box(0.22, 0.22, 0.34), // bus
          box(0.06, 0.02, 0.02, 0.14, 0, 0), // panel yokes
          box(0.06, 0.02, 0.02, -0.14, 0, 0),
          box(0.42, 0.015, 0.28, 0.38, 0, 0), // solar arrays
          box(0.42, 0.015, 0.28, -0.38, 0, 0),
          tube(0.01, 0.01, 0.12, 0, 0, 0.23), // antenna boom
        ]),
      ];
    case 'drone':
      return [
        merge([
          box(0.16, 0.05, 0.16), // body
          box(0.3, 0.018, 0.03, 0.13, 0, 0.13, -Math.PI / 4), // arms
          box(0.3, 0.018, 0.03, -0.13, 0, -0.13, -Math.PI / 4),
          box(0.3, 0.018, 0.03, 0.13, 0, -0.13, Math.PI / 4),
          box(0.3, 0.018, 0.03, -0.13, 0, 0.13, Math.PI / 4),
          disc(0.09, 0.012, 0.24, 0.02, 0.24, 10), // rotors
          disc(0.09, 0.012, -0.24, 0.02, 0.24, 10),
          disc(0.09, 0.012, 0.24, 0.02, -0.24, 10),
          disc(0.09, 0.012, -0.24, 0.02, -0.24, 10),
        ]),
      ];
    case 'ambulance':
      return [
        merge([
          box(0.56, 0.07, 0.15), // medical cross
          box(0.15, 0.07, 0.56),
          disc(0.09, 0.08, 0, 0.01, 0, 10), // hub
        ]),
      ];
    case 'stealth':
      return [
        merge([
          // B-2 flying wing with sawtooth trailing edge.
          wing([[0, 0.5], [0.55, -0.18], [0.38, -0.1], [0.22, -0.34], [0, -0.16], [-0.22, -0.34], [-0.38, -0.1], [-0.55, -0.18]], 0.035, -0.017),
          box(0.1, 0.045, 0.3, 0, 0.02, 0.12), // center bulge
        ]),
      ];
    case 'broadcast':
      return [
        merge([
          tube(0.014, 0.07, 0.15, 0, 0, 0.35),
          tube(0.07, 0.07, 0.55, 0, 0, 0),
          tube(0.07, 0.02, 0.2, 0, 0, -0.375),
          wing([[-0.46, -0.2], [0, 0.12], [0.46, -0.2], [0.46, -0.3], [0, -0.1], [-0.46, -0.3]], 0.028, -0.015),
          wing([[-0.18, -0.42], [0, -0.32], [0.18, -0.42], [0.18, -0.48], [0, -0.38], [-0.18, -0.48]], 0.02),
          box(0.022, 0.17, 0.13, 0, 0.1, -0.38),
          box(0.03, 0.1, 0.03, 0, 0.1, -0.08), // rotodome pylon
          disc(0.26, 0.05, 0, 0.17, -0.08), // rotodome
        ]),
      ];
    default:
      return [merge([tube(0.015, 0.075, 0.16, 0, 0, 0.42), tube(0.075, 0.075, 0.84, 0, 0, -0.08)])];
  }
}

function getGeometries(type: AircraftType): THREE.BufferGeometry[] {
  let g = geoCache.get(type);
  if (!g) {
    g = buildGeometries(type);
    geoCache.set(type, g);
  }
  return g;
}

function getMaterial(color: string, stealth: boolean): THREE.Material {
  const key = stealth ? `${color}|s` : color;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.35,
      emissive: color,
      emissiveIntensity: 0.45, // enough self-glow that planes stand off the dark globe
      transparent: stealth,
      opacity: stealth ? 0.6 : 1,
    });
    matCache.set(key, m);
  }
  return m;
}

function getHalo(): THREE.Mesh {
  if (!haloGeo) haloGeo = new THREE.RingGeometry(0.62, 0.78, 28).rotateX(-Math.PI / 2);
  if (!haloMat)
    haloMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
  const mesh = new THREE.Mesh(haloGeo, haloMat);
  mesh.visible = false;
  return mesh;
}

// ── wingtip nav strobes (airliner-ish types only) ──────────────────────────
// Shared geometry + two shared materials (red left / green right); per-plane
// blink is done by toggling visibility, never by touching the materials.

const STROBE_TIP: Partial<Record<AircraftType, { x: number; z: number }>> = {
  widebody: { x: 0.56, z: -0.29 },
  narrowbody: { x: 0.42, z: -0.22 },
  cargo: { x: 0.52, z: -0.22 },
  privatejet: { x: 0.38, z: -0.34 },
  broadcast: { x: 0.46, z: -0.25 },
  stealth: { x: 0.55, z: -0.18 },
};

let strobeGeo: THREE.BufferGeometry | null = null;
let strobeMatL: THREE.Material | null = null;
let strobeMatR: THREE.Material | null = null;

function makeStrobes(type: AircraftType): THREE.Mesh[] {
  const tip = STROBE_TIP[type];
  if (!tip) return [];
  if (!strobeGeo) strobeGeo = new THREE.SphereGeometry(0.035, 6, 4);
  if (!strobeMatL) strobeMatL = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
  if (!strobeMatR) strobeMatR = new THREE.MeshBasicMaterial({ color: '#34c759' });
  const left = new THREE.Mesh(strobeGeo, strobeMatL);
  left.position.set(-tip.x, 0.02, tip.z);
  const right = new THREE.Mesh(strobeGeo, strobeMatR);
  right.position.set(tip.x, 0.02, tip.z);
  left.visible = false;
  right.visible = false;
  return [left, right];
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Blink the wingtip strobes (~1.2s period). `animate=false` keeps them off. */
export function updateStrobes(obj: THREE.Object3D, now: number, animate: boolean): void {
  const strobes = obj.userData.strobes as THREE.Mesh[] | undefined;
  if (!strobes || strobes.length === 0) return;
  const on = animate && ((now + (obj.userData.strobeOff as number)) % 1200) < 130;
  for (const s of strobes) s.visible = on;
}

// LOD dot: shared low-poly sphere shown instead of the detailed body when the
// camera is far out (recolored together with the body via the isBody tag).
let dotGeo: THREE.BufferGeometry | null = null;
function getDotGeo(): THREE.BufferGeometry {
  if (!dotGeo) dotGeo = new THREE.SphereGeometry(0.16, 6, 5);
  return dotGeo;
}

export function createPlaneMesh(flight: Flight): THREE.Object3D {
  const type = flight.aircraftType;
  const mat = getMaterial(flight.liveryColor, type === 'stealth');
  const group = new THREE.Group();
  for (const g of getGeometries(type)) {
    const body = new THREE.Mesh(g, mat);
    body.userData.isBody = true;
    group.add(body);
  }

  const dot = new THREE.Mesh(getDotGeo(), mat);
  dot.userData.isBody = true; // recolors with the body
  dot.userData.isDot = true;
  dot.visible = false;
  group.add(dot);

  const halo = getHalo();
  group.add(halo);

  const strobes = makeStrobes(type);
  for (const s of strobes) group.add(s);

  const scale = GLOBE_MESH_BASE * TYPE_SCALE[type];
  group.scale.setScalar(scale);
  group.userData.baseScale = scale;
  group.userData.halo = halo;
  group.userData.dot = dot;
  group.userData.strobes = strobes;
  group.userData.strobeOff = hashId(flight.id) % 1200;
  group.userData.color = flight.liveryColor;
  group.userData.far = false;
  return group;
}

// Swap between the detailed silhouette (near) and the shared dot (far).
export function setPlaneLOD(obj: THREE.Object3D, far: boolean): void {
  if (obj.userData.far === far) return;
  obj.userData.far = far;
  const dot = obj.userData.dot as THREE.Mesh | undefined;
  for (const c of obj.children) {
    if (c instanceof THREE.Mesh && c.userData.isBody && !c.userData.isDot) c.visible = !far;
  }
  if (dot) dot.visible = far;
}

// Toggle the selection cue on a plane group (per-object, never touches the
// shared material).
export function setPlaneSelected(obj: THREE.Object3D, selected: boolean): void {
  const base = (obj.userData.baseScale as number) ?? 1;
  obj.scale.setScalar(selected ? base * 1.4 : base);
  const halo = obj.userData.halo as THREE.Mesh | undefined;
  if (halo) {
    halo.visible = selected;
    // Halo is scaled inside the group; undo the selection scale so it stays steady.
    halo.scale.setScalar(selected ? 1 / 1.4 : 1);
  }
}

// Recolor a plane in place (e.g. when the owning process resolves late and the
// livery switches from a host hash to the brand color). Only touches meshes
// tagged as body parts — halo, strobes, and flare keep their own materials.
export function recolorPlane(obj: THREE.Object3D, color: string, type: AircraftType): void {
  if (obj.userData.color === color) return;
  const mat = getMaterial(color, type === 'stealth');
  obj.traverse((c) => {
    if (c instanceof THREE.Mesh && c.userData.isBody) c.material = mat;
  });
  obj.userData.color = color;
}

// ── Landing flare ──────────────────────────────────────────────────────────
// A brief expanding shockwave at touchdown (descent → landed): a bright inner
// ring plus a faster, softer outer ring. Each plane gets its own flare meshes
// + materials on demand so opacity can fade independently of the shared
// selection halo; the materials are disposed the moment the flare ends, and
// landed planes live ~60s (well past the 0.8s flare) so this never leaks.
const FLARE_MS = 800;
let flareGeoInner: THREE.BufferGeometry | null = null;
let flareGeoOuter: THREE.BufferGeometry | null = null;
function getFlareGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (!flareGeoInner) flareGeoInner = new THREE.RingGeometry(0.55, 0.74, 28).rotateX(-Math.PI / 2);
  if (!flareGeoOuter) flareGeoOuter = new THREE.RingGeometry(0.6, 0.7, 28).rotateX(-Math.PI / 2);
  return [flareGeoInner, flareGeoOuter];
}

function makeFlareMat(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function triggerLandingFlare(obj: THREE.Object3D, now: number): void {
  obj.userData.flareStart = now;
}

export function updateLandingFlare(obj: THREE.Object3D, now: number): void {
  const start = obj.userData.flareStart as number | undefined;
  if (start === undefined) return;
  const k = (now - start) / FLARE_MS;
  let flare = obj.userData.flare as THREE.Group | undefined;
  if (k >= 1) {
    if (flare) {
      obj.remove(flare);
      for (const c of flare.children) {
        if (c instanceof THREE.Mesh) (c.material as THREE.Material).dispose();
      }
      obj.userData.flare = undefined;
    }
    obj.userData.flareStart = undefined;
    return;
  }
  if (!flare) {
    const [innerGeo, outerGeo] = getFlareGeos();
    flare = new THREE.Group();
    flare.add(new THREE.Mesh(innerGeo, makeFlareMat(0.95)));
    flare.add(new THREE.Mesh(outerGeo, makeFlareMat(0.5)));
    obj.add(flare);
    obj.userData.flare = flare;
  }
  const ease = 1 - (1 - k) * (1 - k); // ease-out
  const [inner, outer] = flare.children as [THREE.Mesh, THREE.Mesh];
  inner.scale.setScalar(1 + ease * 2.5);
  (inner.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
  outer.scale.setScalar(1.3 + ease * 3.7);
  (outer.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
}

// Drop materials whose color is no longer flying (hashed unknown-process colors
// would otherwise accumulate). Geometries (10 types) are kept.
export function disposeUnusedMaterials(activeColors: Set<string>): void {
  for (const [key, mat] of matCache) {
    const color = key.replace(/\|s$/, '');
    if (!activeColors.has(color)) {
      mat.dispose();
      matCache.delete(key);
    }
  }
}
