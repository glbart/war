// src/render/CoastField.ts
// Equirect-маска океан/берег для шейдера воды. Байт на тексель: 0 = суша, 255 = открытый океан,
// промежуточные — расстояние до ближайшей суши (для мелководного цвета и береговой пены).
// Расстояние — дешёвый многоитерационный разлив (chamfer-подобный) по маске, один раз при старте.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import { isLand as isLandDefault } from '../sim/landmask';
import { COAST_TEX_W, COAST_TEX_H } from '../assets/config';

// Сколько итераций разлива = насколько широкая береговая полоса (в текселях). При 1024×512
// ~24 текселя ≈ мягкий переход в несколько сотен км — достаточно для цвета/пены.
const SPREAD_ITERS = 24;

export function buildCoastData(
  isLand: (lon: number, lat: number) => boolean,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h;
  // dist: 0 = суша; иначе минимальное «манхэттен-подобное» число шагов до суши, обрезанное.
  const dist = new Int32Array(n);
  for (let py = 0; py < h; py++) {
    const lat = Math.PI / 2 - (py / h) * Math.PI;
    for (let px = 0; px < w; px++) {
      const lon = (px / w) * 2 * Math.PI - Math.PI;
      dist[py * w + px] = isLand(lon, lat) ? 0 : SPREAD_ITERS + 1;
    }
  }
  // Разлив: dist[i] = min(dist[i], min(соседи)+1). Несколько проходов вперёд и назад.
  const idx = (px: number, py: number): number => {
    const wx = ((px % w) + w) % w; // wrap по долготе
    const wy = Math.max(0, Math.min(h - 1, py)); // clamp по широте
    return wy * w + wx;
  };
  const relax = (px: number, py: number): void => {
    const i = py * w + px;
    if (dist[i] === 0) return;
    let m = dist[i]!;
    m = Math.min(m, dist[idx(px - 1, py)]! + 1);
    m = Math.min(m, dist[idx(px + 1, py)]! + 1);
    m = Math.min(m, dist[idx(px, py - 1)]! + 1);
    m = Math.min(m, dist[idx(px, py + 1)]! + 1);
    dist[i] = m;
  };
  for (let pass = 0; pass < SPREAD_ITERS; pass++) {
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) relax(px, py);
    for (let py = h - 1; py >= 0; py--) for (let px = w - 1; px >= 0; px--) relax(px, py);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.min(dist[i]!, SPREAD_ITERS + 1);
    // 0 суша → 0; открытый океан (d > SPREAD_ITERS) → 255; берег — линейно.
    out[i] = d === 0 ? 0 : Math.round((Math.min(d, SPREAD_ITERS) / SPREAD_ITERS) * 255);
  }
  return out;
}

export function buildCoastTexture(
  ctx: ThreeCtx,
  w = COAST_TEX_W,
  h = COAST_TEX_H,
): THREE.DataTexture {
  const { THREE } = ctx;
  const data = buildCoastData(isLandDefault, w, h);
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
