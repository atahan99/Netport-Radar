// src/lib/globe-planes.ts
// Per-frame plane placement on the 3D globe and screen-space picking. Both use
// flightWorldPos, so a plane is clickable exactly where it is drawn.

import * as THREE from 'three';
import type { Flight, HomeAirport } from '@/types';
import type { GlobeApi } from './view-refs';
import { flightWorldPos } from './flight-pos';
import { orientPlaneMesh } from './mesh-orientation';
import { reducedMotion } from './motion';
import {
  setPlaneSelected,
  setPlaneLOD,
  recolorPlane,
  triggerLandingFlare,
  updateLandingFlare,
  updateStrobes,
} from './globe-meshes';

const BANK_RAD = 0.45; // bank angle while circling (hold / LAN orbit)

// Per-frame scratch: never allocate inside the mesh-update loop.
const _pos = new THREE.Vector3();
const _fwdHint = new THREE.Vector3();

// Position, orient, scale and flare a plane mesh for `progress` along its arc.
export function positionPlaneMesh(
  o: THREE.Object3D,
  f: Flight,
  home: HomeAirport | undefined,
  g: GlobeApi,
  now: number,
  progress: number,
  opts: { selected: boolean; far: boolean },
): void {
  const { lat, lng, alt, pose } = flightWorldPos(f, home, now, progress);
  const c = g.getCoords(lat, lng, alt);
  _pos.set(c.x, c.y, c.z);
  o.position.copy(_pos);
  // Forward hint: the pose slightly in the future, so orbiting planes (hold
  // circles, LAN) face along their actual motion, not just the arc.
  const next = flightWorldPos(f, home, now + 130, Math.min(1, progress + 0.01));
  const nc = g.getCoords(next.lat, next.lng, alt);
  _fwdHint.set(nc.x, nc.y, nc.z);
  const banking = !reducedMotion() && (f.phase === 'hold' || (f.isLan && f.phase !== 'landed'));
  orientPlaneMesh(_pos, _fwdHint, o.quaternion, banking ? BANK_RAD : 0);
  setPlaneSelected(o, opts.selected);
  // Taxi spool / landed shrink layers on top of the selection scale.
  o.scale.multiplyScalar(pose.scale);
  recolorPlane(o, f.liveryColor, f.aircraftType);
  // One-shot landing flare on touchdown (descent → landed).
  if (o.userData.phase !== f.phase) {
    if (f.phase === 'landed' && o.userData.phase && !reducedMotion()) triggerLandingFlare(o, now);
    o.userData.phase = f.phase;
  }
  updateLandingFlare(o, now);
  setPlaneLOD(o, opts.far);
  updateStrobes(o, now, !reducedMotion() && !opts.far && f.phase !== 'landed');
}

// Nearest flight within `radiusPx` of a screen point, projected at its drawn
// position (arc altitude plus orbit offsets). Planes on the far side of the
// globe are skipped: they project to valid screen coords but are hidden.
export function pickFlightAt(
  g: GlobeApi,
  flights: readonly Flight[],
  homeById: (id: string) => HomeAirport | undefined,
  x: number,
  y: number,
  radiusPx: number,
  now: number,
): Flight | null {
  const cp = g.camera().position;
  const camDist2 = cp.x * cp.x + cp.y * cp.y + cp.z * cp.z;
  let best: Flight | null = null;
  let bestD = radiusPx * radiusPx;
  for (const f of flights) {
    const { lat, lng, alt } = flightWorldPos(f, homeById(f.homeAirportId), now);
    const c = g.getCoords(lat, lng, alt);
    const dxc = c.x - cp.x;
    const dyc = c.y - cp.y;
    const dzc = c.z - cp.z;
    if (dxc * dxc + dyc * dyc + dzc * dzc > camDist2) continue;
    const sc = g.getScreenCoords(lat, lng, alt);
    const dx = sc.x - x;
    const dy = sc.y - y;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) {
      bestD = dd;
      best = f;
    }
  }
  return best;
}
