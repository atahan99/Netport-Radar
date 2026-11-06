// src/lib/interpolate.ts
// Great-circle (slerp) interpolation along the arc + heading at a progress.

export interface ArcPoint {
  lat: number;
  lng: number;
  heading: number; // compass bearing in degrees (0 = north, 90 = east)
}

type Vec3 = [number, number, number];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function toVec(latDeg: number, lngDeg: number): Vec3 {
  const lat = toRad(latDeg);
  const lng = toRad(lngDeg);
  return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
}

function toLatLng(v: Vec3): [number, number] {
  return [toDeg(Math.asin(v[2])), toDeg(Math.atan2(v[1], v[0]))];
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a;
  const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
  const s2 = Math.sin(t * omega) / Math.sin(omega);
  return [a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2];
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dl = toRad(lng2 - lng1);
  const y = Math.sin(dl) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
  // Compass bearing: 0 = north, 90 = east.
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function interpolateArc(
  srcLat: number,
  srcLng: number,
  dstLat: number,
  dstLng: number,
  progress: number,
): ArcPoint {
  const a = toVec(srcLat, srcLng);
  const b = toVec(dstLat, dstLng);
  const p = Math.max(0, Math.min(1, progress));
  const [lat, lng] = toLatLng(slerp(a, b, p));
  const [lat2, lng2] = toLatLng(slerp(a, b, Math.min(1, p + 0.01)));
  const heading = p >= 1 ? bearing(lat, lng, dstLat, dstLng) : bearing(lat, lng, lat2, lng2);
  return { lat, lng, heading };
}

// Sample the great circle into [lng, lat] points for a GeoJSON LineString.
export function arcPoints(
  srcLat: number,
  srcLng: number,
  dstLat: number,
  dstLng: number,
  upTo = 1,
  steps = 48,
): [number, number][] {
  const a = toVec(srcLat, srcLng);
  const b = toVec(dstLat, dstLng);
  const end = Math.max(0, Math.min(1, upTo));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * end;
    const [lat, lng] = toLatLng(slerp(a, b, t));
    out.push([lng, lat]);
  }
  return out;
}

export function greatCircleKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Arc peak altitude on the globe (fraction of its radius). Grows smoothly with
// distance and caps at ARC_ALT_MAX, so a long-haul arc stays inside the frame
// at the default camera distance instead of leaving it as a straight line.
const ARC_ALT_MIN = 0.05;
const ARC_ALT_MAX = 0.22;
const ARC_ALT_PER_KM = 0.000017; // reaches the cap around 10,000 km
export function arcAltitude(km: number): number {
  return Math.min(ARC_ALT_MAX, ARC_ALT_MIN + Math.max(0, km) * ARC_ALT_PER_KM);
}
