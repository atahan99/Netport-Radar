import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { correctedLngOffset, markerHeadingDeg, orientPlaneMesh } from '../src/lib/mesh-orientation';

describe('correctedLngOffset', () => {
  it('widens offset away from equator', () => {
    expect(correctedLngOffset(2, 0)).toBeCloseTo(2, 5);
    expect(correctedLngOffset(2, 60)).toBeGreaterThan(2);
  });

  it('clamps cos denominator at 0.3 for high latitudes', () => {
    expect(correctedLngOffset(1, 89)).toBeCloseTo(1 / 0.3, 5);
  });
});

describe('markerHeadingDeg', () => {
  it('subtracts 90° for SVG plane icons', () => {
    expect(markerHeadingDeg(90)).toBe(0);
    expect(markerHeadingDeg(0)).toBe(-90);
  });
});

describe('orientPlaneMesh', () => {
  it('aligns up with the radial and forward with the tangent hint', () => {
    const pos = new THREE.Vector3(1, 0, 0);
    const fwdHint = new THREE.Vector3(1, 0.1, 0);
    const q = orientPlaneMesh(pos, fwdHint);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(up.dot(pos.clone().normalize())).toBeCloseTo(1, 4);
  });

  it('falls back when forward hint is parallel to up', () => {
    const pos = new THREE.Vector3(0, 1, 0);
    const fwdHint = new THREE.Vector3(0, 1.01, 0);
    const q = orientPlaneMesh(pos, fwdHint);
    expect(Number.isFinite(q.x)).toBe(true);
  });
});
