// src/lib/globe-meshes.ts
// Three.js plane meshes for the globe. One THREE.Group per aircraft type,
// built nose-along +Z, up +Y. Geometry is cached per type, material per color,
// so the 150-plane fleet shares a handful of GPU resources. A shared halo ring
// child marks the selected plane.

import * as THREE from 'three';
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

function buildGeometries(type: AircraftType): THREE.BufferGeometry[] {
  switch (type) {
    case 'widebody':
      return [
        box(0.16, 0.16, 1.0),
        box(1.1, 0.05, 0.24, 0, 0, -0.05),
        box(0.5, 0.05, 0.14, 0, 0, -0.42),
        box(0.05, 0.2, 0.14, 0, 0.12, -0.42),
      ];
    case 'narrowbody':
      return [
        box(0.13, 0.13, 0.9),
        box(0.8, 0.04, 0.2, 0, 0, -0.03),
        box(0.36, 0.04, 0.12, 0, 0, -0.4),
        box(0.04, 0.16, 0.12, 0, 0.1, -0.4),
      ];
    case 'cargo':
      return [
        box(0.22, 0.22, 1.0),
        box(1.0, 0.06, 0.26, 0, 0.1, 0.05),
        box(0.5, 0.05, 0.16, 0, 0, -0.42),
        box(0.05, 0.24, 0.16, 0, 0.14, -0.42),
      ];
    case 'helicopter':
      return [
        box(0.2, 0.18, 0.5),
        box(0.06, 0.06, 0.5, 0, 0, -0.42),
        new THREE.CylinderGeometry(0.5, 0.5, 0.02, 20).translate(0, 0.16, 0),
        box(0.02, 0.16, 0.16, 0, 0.06, -0.6),
      ];
    case 'privatejet':
      return [
        box(0.12, 0.12, 0.95),
        box(0.7, 0.04, 0.3, 0, 0, -0.12, 0.3),
        box(0.3, 0.04, 0.1, 0, 0, -0.42),
        box(0.04, 0.16, 0.12, 0, 0.1, -0.42),
      ];
    case 'satellite':
      return [
        box(0.14, 0.14, 0.8),
        box(0.5, 0.02, 0.3, 0.4, 0, 0),
        box(0.5, 0.02, 0.3, -0.4, 0, 0),
      ];
    case 'drone':
      return [
        box(0.18, 0.06, 0.18),
        box(0.55, 0.02, 0.05),
        box(0.05, 0.02, 0.55),
      ];
    case 'ambulance':
      return [box(0.55, 0.09, 0.16), box(0.16, 0.09, 0.55)];
    case 'stealth':
      return [box(0.75, 0.03, 0.55), box(0.12, 0.05, 0.4)];
    case 'broadcast':
      return [
        box(0.2, 0.16, 0.9),
        box(0.9, 0.05, 0.24),
        new THREE.CylinderGeometry(0.18, 0.18, 0.03, 16).rotateX(Math.PI / 2.5).translate(0, 0.16, 0.1),
      ];
    default:
      return [box(0.16, 0.16, 1.0)];
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
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
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

export function createPlaneMesh(flight: Flight): THREE.Object3D {
  const type = flight.aircraftType;
  const mat = getMaterial(flight.liveryColor, type === 'stealth');
  const group = new THREE.Group();
  for (const g of getGeometries(type)) group.add(new THREE.Mesh(g, mat));

  const halo = getHalo();
  group.add(halo);

  const scale = GLOBE_MESH_BASE * TYPE_SCALE[type];
  group.scale.setScalar(scale);
  group.userData.baseScale = scale;
  group.userData.halo = halo;
  group.userData.color = flight.liveryColor;
  return group;
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
// livery switches from a host hash to the brand color). Keeps the halo.
export function recolorPlane(obj: THREE.Object3D, color: string, type: AircraftType): void {
  if (obj.userData.color === color) return;
  const mat = getMaterial(color, type === 'stealth');
  const halo = obj.userData.halo as THREE.Mesh | undefined;
  obj.traverse((c) => {
    if (c instanceof THREE.Mesh && c !== halo) c.material = mat;
  });
  obj.userData.color = color;
}

// ── Landing flare ──────────────────────────────────────────────────────────
// A brief expanding white ring at touchdown (descent → landed). Each plane gets
// its own flare mesh + material on demand so opacity can fade independently of
// the shared selection halo; the material is disposed the moment the flare ends,
// and landed planes live ~60s (well past the 0.8s flare) so this never leaks.
const FLARE_MS = 800;
let flareGeo: THREE.BufferGeometry | null = null;
function getFlareGeo(): THREE.BufferGeometry {
  if (!flareGeo) flareGeo = new THREE.RingGeometry(0.55, 0.74, 28).rotateX(-Math.PI / 2);
  return flareGeo;
}

export function triggerLandingFlare(obj: THREE.Object3D, now: number): void {
  obj.userData.flareStart = now;
}

export function updateLandingFlare(obj: THREE.Object3D, now: number): void {
  const start = obj.userData.flareStart as number | undefined;
  if (start === undefined) return;
  const k = (now - start) / FLARE_MS;
  let flare = obj.userData.flare as THREE.Mesh | undefined;
  if (k >= 1) {
    if (flare) {
      obj.remove(flare);
      (flare.material as THREE.Material).dispose();
      obj.userData.flare = undefined;
    }
    obj.userData.flareStart = undefined;
    return;
  }
  if (!flare) {
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    flare = new THREE.Mesh(getFlareGeo(), mat);
    obj.add(flare);
    obj.userData.flare = flare;
  }
  flare.scale.setScalar(1 + k * 3.5);
  (flare.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
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
