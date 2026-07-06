// Состояние воксельной коры. ЧИСТЫЙ TS (без three) — тестируется headless, детерминирован.
// Хранение ленивое: чанк материализуется (Uint8Array) только когда его впервые режет carve;
// нетронутые воксели вычисляются на лету из landmask/биома (pristineVoxel) — память ~0 до ударов.
// Каналы значений — материал-id (MAT_*). Вода (океанские столбцы) НЕ карвится и мешится как
// «морское дно» (иначе у берега глобус-дырка показала бы магму под океаном).
import type { Vec3 } from '../sim/geo';
import { dot } from '../sim/geo';
import { materialAtDir } from '../sim/material';
import { faceUVToDir, dirToFaceUV, type FaceId } from './cubesphere';
import {
  CRUST_FACE_N,
  CRUST_DEPTH_LAYERS,
  CRUST_CHUNK,
  CRUST_VOX_ANG,
  CRUST_VOX_H,
} from '../assets/config';

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

export interface CarveResult {
  changed: string[]; // ключи чанков на ремеш (задетые + боковые соседи)
  removed: number; // сколько вокселей выбито этим ударом
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

  // Кол-во материализованных чанков — для тестов ленивости/перф-санити.
  get materializedChunks(): number {
    return this.chunks.size;
  }

  // Детерминированный хеш → [0,1): рваные края carve-эллипсоида без Math.random.
  private static jitter(face: number, x: number, y: number, seed: number): number {
    let h = (face * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ (seed * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Выгрызает эллипсоид: боковая полуось radiusRad (рад), радиальная — depthVox слоёв.
  // Центр — на ТЕКУЩЕЙ поверхности столбца эпицентра (первый непустой воксель) → повторные
  // удары в ту же точку копают глубже. Вода не карвится. Возвращает чанки на ремеш.
  carve(dir: Vec3, radiusRad: number, depthVox: number, seed: number): CarveResult {
    // 1) текущая поверхность в эпицентре
    const c = dirToFaceUV(dir);
    const ex = Math.min(N - 1, Math.floor(c.u * N));
    const ey = Math.min(N - 1, Math.floor(c.v * N));
    let surfD = 0;
    while (surfD < D && this.getVoxel(c.face, ex, ey, surfD) === MAT_EMPTY) surfD++;
    const centerR = 1 - (surfD + 0.5) * CRUST_VOX_H;

    const changed = new Set<string>();
    let removed = 0;
    const latR = Math.max(radiusRad, CRUST_VOX_ANG * 0.75); // не уже одного вокселя
    const radR = Math.max(depthVox, 1) * CRUST_VOX_H;
    // столбцы дальше angLim гарантированно вне эллипсоида (с запасом на джиттер)
    const cosLim = Math.cos(Math.min(latR * 1.4 + CRUST_VOX_ANG, Math.PI / 2));

    for (let face = 0 as FaceId; face < 6; face++) {
      for (let cy = 0; cy < N / CH; cy++)
        for (let cx = 0; cx < N / CH; cx++) {
          // быстрый чанк-реджект по углу до центра чанка (запас — полдиагонали чанка)
          const chunkDir = this.columnDir(face, cx * CH + CH / 2, cy * CH + CH / 2);
          const chunkHalf = CH * CRUST_VOX_ANG; // с запасом (чанк ≤ CH·voxAng по диагонали/√2·2)
          if (dot(chunkDir, dir) < Math.cos(Math.min(latR * 1.4 + chunkHalf, Math.PI))) continue;

          let chunk: Uint8Array | null = null;
          for (let ly = 0; ly < CH; ly++)
            for (let lx = 0; lx < CH; lx++) {
              const x = cx * CH + lx;
              const y = cy * CH + ly;
              const colDir = this.columnDir(face, x, y);
              const cosAng = dot(colDir, dir);
              if (cosAng < cosLim) continue;
              const ang = Math.acos(Math.min(1, cosAng));
              const t = ang / latR;
              if (t > 1.3) continue;
              const jit = 1 + (Crust.jitter(face, x, y, seed) - 0.5) * 0.3;
              let removedInColumn = 0;
              for (let d = 0; d < D; d++) {
                const rv = 1 - (d + 0.5) * CRUST_VOX_H;
                const s = (rv - centerR) / radR;
                if (t * t + s * s > jit) continue;
                const idx = (ly * CH + lx) * D + d;
                // Читаем материал БЕЗ материализации чанка: если чанк ещё не создан —
                // через getVoxel (Map + pristine-фолбэк), иначе — быстрый путь по массиву.
                const m = chunk ? (chunk[idx] ?? MAT_EMPTY) : this.getVoxel(face, x, y, d);
                if (m === MAT_EMPTY || m === MAT_WATER) continue;
                // Материализуем чанк ТОЛЬКО когда реально есть что стереть.
                chunk ??= this.ensureChunk(face, cx, cy);
                chunk[idx] = MAT_EMPTY;
                removed++;
                removedInColumn++;
              }
              if (removedInColumn > 0) {
                changed.add(this.chunkKey(face, cx, cy));
                // боковые соседи задетых ГРАНИЧНЫХ столбцов — тоже на ремеш (их margin изменился)
                if (lx === 0 && cx > 0) changed.add(this.chunkKey(face, cx - 1, cy));
                if (lx === CH - 1 && cx < N / CH - 1) changed.add(this.chunkKey(face, cx + 1, cy));
                if (ly === 0 && cy > 0) changed.add(this.chunkKey(face, cx, cy - 1));
                if (ly === CH - 1 && cy < N / CH - 1) changed.add(this.chunkKey(face, cx, cy + 1));
              }
            }
        }
    }
    this.removedVoxels += removed;
    return { changed: [...changed].sort(), removed };
  }
}
