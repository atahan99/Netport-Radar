// src/lib/globe-plane-geometry.ts
// Low-poly aircraft silhouettes for the globe, one per aircraft type, built
// nose-along +Z, up +Y from primitives (tapered fuselage cylinders, extruded
// wing shapes, nacelles) merged into a few BufferGeometries and cached per type.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftType } from '@/types';

const geoCache = new Map<AircraftType, THREE.BufferGeometry[]>();

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

export function getGeometries(type: AircraftType): THREE.BufferGeometry[] {
  let g = geoCache.get(type);
  if (!g) {
    g = buildGeometries(type);
    geoCache.set(type, g);
  }
  return g;
}
