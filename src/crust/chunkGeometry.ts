// Геометрия чанка коры: Surface Nets в координатах решётки → мировые позиции на cube-sphere.
// Узел решётки (gx,gy,gd) → uv грани ((глоб. столбец + 0.5)/N) → dir; радиус r = 1 − (gd+0.5)·VOX_H.
// Вершина верхней границы (между пустым d=−1 и твёрдым d=0) имеет gd = −0.5 → r = 1−LID_DROP —
// крышка нетронутой части чанка лежит НА ВОЛОСОК ПОД сферой (см. LID_DROP ниже): вне диска
// дискарда (HoleMask.markCarve) её всё равно закрывает сам глобус, а внутри диска ступенька
// невидима — так убран прямоугольный «козырёк» крышки чанка над дискардом на глобусе.
// UV — equirect В КОНВЕНЦИИ СФЕРЫ (v = (lat+π/2)/π, север = 1): тот же сэмпл biome/damage,
// что у GlobeView. Чистый модуль (без three) — тестируется headless.
import { dirToLonLat } from '../sim/geo';
import { Crust, MAT_EMPTY } from './Crust';
import { surfaceNets } from './surfaceNets';
import { faceUVToDir, type FaceId } from './cubesphere';
import { CRUST_FACE_N, CRUST_DEPTH_LAYERS, CRUST_CHUNK, CRUST_VOX_H } from '../assets/config';

const N = CRUST_FACE_N;
const D = CRUST_DEPTH_LAYERS;
const CH = CRUST_CHUNK;
// Крышка нетронутого чанка опускается на волосок под сферу (r=1), а не лежит ровно на ней:
// вне зоны дискарда (HoleMask.markCarve — диск вокруг реального карва) эту крышку всё равно
// закрывает сам глобус (сплошной r=1 выше по стеку), поэтому z-fight исключён; а внутри диска
// дискарда ступенька в 0.0005R визуально неотличима от нуля. Взамен крышка больше не выступает
// прямоугольным «козырьком» поверх глобуса на границе чанка.
const LID_DROP = 0.0005;

export interface ChunkGeo {
  positions: Float32Array;
  uvs: Float32Array;
  mats: Float32Array;
  indices: Uint32Array;
}

export function buildChunkGeo(crust: Crust, face: FaceId, cx: number, cy: number): ChunkGeo | null {
  const x0 = cx * CH;
  const y0 = cy * CH;
  const solidAt = (lx: number, ly: number, ld: number): boolean =>
    crust.getVoxelExt(face, x0 + lx, y0 + ly, ld) !== MAT_EMPTY;
  const matAt = (lx: number, ly: number, ld: number): number =>
    crust.getVoxelExt(face, x0 + lx, y0 + ly, ld);
  // дедуп квадов между чанками: владелец ребра — чанк, в чей диапазон [0..CH−1] попадает
  // нижняя боковая координата ребра
  const ownQuad = (ex: number, ey: number): boolean => ex >= 0 && ex < CH && ey >= 0 && ey < CH;

  const nets = surfaceNets(solidAt, matAt, CH, CH, D, ownQuad);
  if (nets.tris.length === 0) return null;

  const nVerts = nets.verts.length / 3;
  const positions = new Float32Array(nVerts * 3);
  const uvs = new Float32Array(nVerts * 2);
  const mats = new Float32Array(nets.vmat);
  for (let i = 0; i < nVerts; i++) {
    const gx = nets.verts[i * 3]!;
    const gy = nets.verts[i * 3 + 1]!;
    const gd = nets.verts[i * 3 + 2]!;
    const dir = faceUVToDir(face, (x0 + gx + 0.5) / N, (y0 + gy + 0.5) / N);
    // r=1−LID_DROP на верхней границе (gd=−0.5) — крышка чуть ПОД сферой (см. LID_DROP выше);
    // не даём вершинам выпирать над этим потолком из-за джиттера сети
    const r = Math.min(1 - LID_DROP, 1 - (gd + 0.5) * CRUST_VOX_H);
    positions[i * 3] = dir.x * r;
    positions[i * 3 + 1] = dir.y * r;
    positions[i * 3 + 2] = dir.z * r;
    const { lon, lat } = dirToLonLat(dir);
    uvs[i * 2] = (lon + Math.PI) / (2 * Math.PI);
    uvs[i * 2 + 1] = (lat + Math.PI / 2) / Math.PI;
  }
  return { positions, uvs, mats, indices: new Uint32Array(nets.tris) };
}
