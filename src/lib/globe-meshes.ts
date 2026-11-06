// src/lib/globe-meshes.ts
// Three.js plane meshes for the globe: one THREE.Group per flight from the
// cached per-type geometry (globe-plane-geometry.ts) and materials cached per
// color, so the 150-plane fleet shares a handful of GPU resources. A shared halo ring child
// marks the selected plane; wingtip nav strobes blink on airliner types.

import * as THREE from 'three';
import type { Flight, AircraftType } from '@/types';
import { getGeometries } from './globe-plane-geometry';

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

const matCache = new Map<string, THREE.Material>();

let haloGeo: THREE.BufferGeometry | null = null;
let haloMat: THREE.Material | null = null;

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
