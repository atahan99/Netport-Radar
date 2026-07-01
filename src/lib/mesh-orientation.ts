// src/lib/mesh-orientation.ts
// Plane mesh orientation on the globe surface — extracted from GlobeView.

import * as THREE from 'three';

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _right = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qRoll = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Widen lng orbit offset by 1/cos(lat) so circles stay round away from the equator. */
export function correctedLngOffset(dLng: number, lat: number): number {
  return dLng / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
}

/** 2D marker SVG rotation: path points east at 0°, plane icon needs −90°. */
export function markerHeadingDeg(heading: number): number {
  return heading - 90;
}

/**
 * Orient a plane mesh on the globe: up = radial from center, forward = tangent
 * toward `forwardTarget` projected onto the tangent plane. Optional `roll`
 * (radians) banks the plane around its forward axis (positive = right wing down).
 */
export function orientPlaneMesh(
  position: THREE.Vector3,
  forwardTarget: THREE.Vector3,
  target?: THREE.Quaternion,
  roll = 0,
): THREE.Quaternion {
  const q = target ?? new THREE.Quaternion();
  _up.copy(position).normalize();
  _fwd.copy(forwardTarget).sub(position);
  _proj.copy(_up).multiplyScalar(_fwd.dot(_up));
  _fwd.sub(_proj);
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
  _fwd.normalize();
  _right.crossVectors(_up, _fwd).normalize();
  _m.makeBasis(_right, _up, _fwd);
  q.setFromRotationMatrix(_m);
  if (roll) {
    _qRoll.setFromAxisAngle(FORWARD, roll);
    q.multiply(_qRoll);
  }
  return q;
}
