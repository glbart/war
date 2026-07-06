// Состояние воксельной коры. ЧИСТЫЙ TS (без three) — тестируется headless, детерминирован.
// Хранение ленивое: чанк материализуется (Uint8Array) только когда его впервые режет carve;
// нетронутые воксели вычисляются на лету из landmask/биома (pristineVoxel) — память ~0 до ударов.
// Каналы значений — материал-id (MAT_*). Вода (океанские столбцы) НЕ карвится и мешится как
// «морское дно» (иначе у берега глобус-дырка показала бы магму под океаном).
import type { Vec3 } from '../sim/geo';
import { materialAtDir } from '../sim/material';
import { faceUVToDir, dirToFaceUV, type FaceId } from './cubesphere';
import { CRUST_FACE_N, CRUST_DEPTH_LAYERS, CRUST_CHUNK } from '../assets/config';

export const MAT_EMPTY = 0;
export const MAT_SOIL = 1;
export const MAT_ROCK = 2;
export const MAT_BASALT = 3;
export const MAT_WATER = 4;

const N = CRUST_FACE_N;
const D = CRUST_DEPTH_LAYERS;
const CH = CRUST_CHUNK;

// Материал нетронутой суши по глубине: грунт (0-1) → порода (2-4) → базальт (5+).
export function pristineMaterial(d: number): number {
  return d <= 1 ? MAT_SOIL : d <= 4 ? MAT_ROCK : MAT_BASALT;
}

export class Crust {
  // Материализованные чанки: ключ 'face:cx:cy' → Uint8Array(CH*CH*D), индекс ((ly*CH+lx)*D+d).
  protected readonly chunks = new Map<string, Uint8Array>();
  removedVoxels = 0;

  chunkKey(face: FaceId, cx: number, cy: number): string {
    return `${face}:${cx}:${cy}`;
  }

  // Направление центра столбца (x,y) грани face.
  columnDir(face: FaceId, x: number, y: number): Vec3 {
    return faceUVToDir(face, (x + 0.5) / N, (y + 0.5) / N);
  }

  // Материал нетронутого вокселя — вычисляется на лету (ленивость хранения).
  private pristineVoxel(face: FaceId, x: number, y: number, d: number): number {
    if (materialAtDir(this.columnDir(face, x, y)).surface === 'water') return MAT_WATER;
    return pristineMaterial(d);
  }

  getVoxel(face: FaceId, x: number, y: number, d: number): number {
    if (x < 0 || y < 0 || x >= N || y >= N || d < 0 || d >= D) return MAT_EMPTY;
    const chunk = this.chunks.get(this.chunkKey(face, Math.floor(x / CH), Math.floor(y / CH)));
    if (chunk) return chunk[((y % CH) * CH + (x % CH)) * D + d] ?? MAT_EMPTY;
    return this.pristineVoxel(face, x, y, d);
  }

  // Как getVoxel, но x/y за краем грани перепроецируются через направление на соседнюю грань
  // (margin-сэмплы мешера у рёбер куба). d за пределами глубины — по-прежнему пусто.
  getVoxelExt(face: FaceId, x: number, y: number, d: number): number {
    if (d < 0 || d >= D) return MAT_EMPTY;
    if (x >= 0 && y >= 0 && x < N && y < N) return this.getVoxel(face, x, y, d);
    const dir = faceUVToDir(face, (x + 0.5) / N, (y + 0.5) / N);
    const p = dirToFaceUV(dir);
    const nx = Math.min(N - 1, Math.max(0, Math.floor(p.u * N)));
    const ny = Math.min(N - 1, Math.max(0, Math.floor(p.v * N)));
    return this.getVoxel(p.face, nx, ny, d);
  }

  // Материализует чанк (копирует pristine-состояние в Uint8Array) — вызывается перед записью.
  protected ensureChunk(face: FaceId, cx: number, cy: number): Uint8Array {
    const key = this.chunkKey(face, cx, cy);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    chunk = new Uint8Array(CH * CH * D);
    for (let ly = 0; ly < CH; ly++)
      for (let lx = 0; lx < CH; lx++) {
        const water =
          materialAtDir(this.columnDir(face, cx * CH + lx, cy * CH + ly)).surface === 'water';
        for (let d = 0; d < D; d++)
          chunk[(ly * CH + lx) * D + d] = water ? MAT_WATER : pristineMaterial(d);
      }
    this.chunks.set(key, chunk);
    return chunk;
  }

  reset(): void {
    this.chunks.clear();
    this.removedVoxels = 0;
  }
}
