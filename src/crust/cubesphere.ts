// Cube-sphere проекция для воксельной коры: 6 граней куба, каждая грань — сетка N×N столбцов.
// u,v ∈ [0,1] на грани; допускается лёгкая экстраполяция за [0,1] (margin-сэмплы мешера у края
// грани) — точка на плоскости куба нормализуется в любой случай. Слой d — глубина: воксель
// (x,y,d) имеет центр на радиусе r = 1 − (d+0.5)·CRUST_VOX_H (d=0 — поверхность).
import type { Vec3 } from '../sim/geo';

export type FaceId = 0 | 1 | 2 | 3 | 4 | 5; // +X −X +Y −Y +Z −Z

export function faceUVToDir(face: FaceId, u: number, v: number): Vec3 {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  let p: Vec3;
  switch (face) {
    case 0:
      p = { x: 1, y: b, z: -a };
      break;
    case 1:
      p = { x: -1, y: b, z: a };
      break;
    case 2:
      p = { x: a, y: 1, z: -b };
      break;
    case 3:
      p = { x: a, y: -1, z: b };
      break;
    case 4:
      p = { x: a, y: b, z: 1 };
      break;
    default:
      p = { x: -a, y: b, z: -1 };
      break;
  }
  const len = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

export function dirToFaceUV(dir: Vec3): { face: FaceId; u: number; v: number } {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  let face: FaceId;
  let a: number;
  let b: number;
  if (ax >= ay && ax >= az) {
    face = dir.x > 0 ? 0 : 1;
    b = dir.y / ax;
    a = dir.x > 0 ? -dir.z / ax : dir.z / ax;
  } else if (ay >= az) {
    face = dir.y > 0 ? 2 : 3;
    a = dir.x / ay;
    b = dir.y > 0 ? -dir.z / ay : dir.z / ay;
  } else {
    face = dir.z > 0 ? 4 : 5;
    b = dir.y / az;
    a = dir.z > 0 ? dir.x / az : -dir.x / az;
  }
  return { face, u: (a + 1) / 2, v: (b + 1) / 2 };
}
