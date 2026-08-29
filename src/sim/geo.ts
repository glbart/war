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

// Обратна lonLatToDir: широта из y, долгота из atan2(-z, x) (та же ось-конвенция).
export function dirToLonLat(dir: Vec3): { lon: number; lat: number } {
  return { lon: Math.atan2(-dir.z, dir.x), lat: Math.asin(clamp(dir.y, -1, 1)) };
}

// Отклоняет направление dir на угол ang в азимуте az (рад) — точка на конусе вокруг dir.
// Используется для разброса пусковых площадок вокруг города (sim/Simulation.applySalvo):
// базис строится от наименее коллинеарной оси, поэтому вырождения у полюсов нет.
export function jitterDir(dir: Vec3, ang: number, az: number): Vec3 {
  const ax = Math.abs(dir.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const t1x = ax.y * dir.z - ax.z * dir.y;
  const t1y = ax.z * dir.x - ax.x * dir.z;
  const t1z = ax.x * dir.y - ax.y * dir.x;
  const inv = 1 / Math.max(1e-9, Math.hypot(t1x, t1y, t1z));
  const u = { x: t1x * inv, y: t1y * inv, z: t1z * inv };
  const v = {
    x: dir.y * u.z - dir.z * u.y,
    y: dir.z * u.x - dir.x * u.z,
    z: dir.x * u.y - dir.y * u.x,
  };
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const x = dir.x * c + (u.x * ca + v.x * sa) * s;
  const y = dir.y * c + (u.y * ca + v.y * sa) * s;
  const z = dir.z * c + (u.z * ca + v.z * sa) * s;
  const n = 1 / Math.max(1e-9, Math.hypot(x, y, z));
  return { x: x * n, y: y * n, z: z * n };
}
