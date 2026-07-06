// След чанка в equirect-канве (для маски дырок глобуса). Координаты нормированы:
// x = (lon+π)/2π ∈ [0,1], y = (π/2−lat)/π ∈ [0,1] (y=0 — СЕВЕР: как строки биом-канвы,
// canvas flipY=true возвращает соответствие сфере). Периметр чанка сэмплируется по 4 точки
// на сторону (кривизна cube-sphere), шов долготы → wrap, полюс внутри чанка → poleBand.
import { faceUVToDir, type FaceId } from './cubesphere';
import { dirToLonLat } from '../sim/geo';
import { CRUST_FACE_N, CRUST_CHUNK } from '../assets/config';

const N = CRUST_FACE_N;
const CH = CRUST_CHUNK;
const SAMPLES_PER_EDGE = 4;

export interface ChunkFootprint {
  xs: number[];
  ys: number[];
  wrap: boolean;
  poleBand: { yMin: number; yMax: number } | null;
}

export function chunkFootprint(face: FaceId, cx: number, cy: number): ChunkFootprint {
  const u0 = (cx * CH) / N;
  const u1 = ((cx + 1) * CH) / N;
  const v0 = (cy * CH) / N;
  const v1 = ((cy + 1) * CH) / N;
  // периметр чанка по часовой: 4 стороны × SAMPLES_PER_EDGE точек
  const pts: Array<{ u: number; v: number }> = [];
  for (let i = 0; i < SAMPLES_PER_EDGE; i++)
    pts.push({ u: u0 + ((u1 - u0) * i) / SAMPLES_PER_EDGE, v: v0 });
  for (let i = 0; i < SAMPLES_PER_EDGE; i++)
    pts.push({ u: u1, v: v0 + ((v1 - v0) * i) / SAMPLES_PER_EDGE });
  for (let i = 0; i < SAMPLES_PER_EDGE; i++)
    pts.push({ u: u1 - ((u1 - u0) * i) / SAMPLES_PER_EDGE, v: v1 });
  for (let i = 0; i < SAMPLES_PER_EDGE; i++)
    pts.push({ u: u0, v: v1 - ((v1 - v0) * i) / SAMPLES_PER_EDGE });

  const xs: number[] = [];
  const ys: number[] = [];
  let poleN = false;
  let poleS = false;
  for (const p of pts) {
    const { lon, lat } = dirToLonLat(faceUVToDir(face, p.u, p.v));
    xs.push((lon + Math.PI) / (2 * Math.PI));
    ys.push((Math.PI / 2 - lat) / Math.PI);
  }
  // полюс внутри чанка: грань ±Y и полюсная uv-точка (0.5,0.5) в границах чанка
  if (face === 2 && u0 <= 0.5 && 0.5 <= u1 && v0 <= 0.5 && 0.5 <= v1) poleN = true;
  if (face === 3 && u0 <= 0.5 && 0.5 <= u1 && v0 <= 0.5 && 0.5 <= v1) poleS = true;

  const wrap = Math.max(...xs) - Math.min(...xs) > 0.5;
  let poleBand: ChunkFootprint['poleBand'] = null;
  if (poleN) poleBand = { yMin: 0, yMax: Math.max(...ys) };
  if (poleS) poleBand = { yMin: Math.min(...ys), yMax: 1 };
  return { xs, ys, wrap, poleBand };
}
