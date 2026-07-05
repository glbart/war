export type Vec3 = { x: number; y: number; z: number };

export const MAX_MERC_LAT = (85.05112878 * Math.PI) / 180;

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

// Соглашение осей идентично демо и UV-развёртке SphereGeometry three.js.
export function lonLatToDir(lonRad: number, latRad: number): Vec3 {
  const cl = Math.cos(latRad);
  return { x: cl * Math.cos(lonRad), y: Math.sin(latRad), z: -cl * Math.sin(lonRad) };
}

export function latToTileYf(latRad: number, n: number): number {
  const lat = clamp(latRad, -MAX_MERC_LAT, MAX_MERC_LAT);
  return ((1 - Math.log(Math.tan(lat / 2 + Math.PI / 4)) / Math.PI) / 2) * n;
}

export function tileYfToLat(yf: number, n: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * yf) / n)));
}
