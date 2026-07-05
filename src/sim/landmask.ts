// Декодер запечённой грубой маски суша/вода реальной Земли.
// Данные лежат в landmask.data.ts (автогенерация, см. scripts/gen-landmask.mjs).
import { LANDMASK_W, LANDMASK_H, LANDMASK_BITS_B64 } from './landmask.data';

// Ленивое декодирование base64 → Uint8Array bitset (Node и браузер: atob есть в обоих
// современных рантаймах; в Node ≥16 — глобальный).
let bits: Uint8Array | null = null;
function getBits(): Uint8Array {
  if (bits) return bits;
  const bin = atob(LANDMASK_BITS_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  bits = out;
  return out;
}

// Суша ли в точке (lonRad ∈ [-π,π], latRad ∈ [-π/2,π/2]). Equirect-сэмпл ближайшего пикселя.
export function isLand(lonRad: number, latRad: number): boolean {
  const u = (lonRad + Math.PI) / (2 * Math.PI);
  const v = (Math.PI / 2 - latRad) / Math.PI;
  const px = Math.min(LANDMASK_W - 1, Math.max(0, Math.floor(u * LANDMASK_W)));
  const py = Math.min(LANDMASK_H - 1, Math.max(0, Math.floor(v * LANDMASK_H)));
  const idx = py * LANDMASK_W + px;
  return (getBits()[idx >> 3]! & (1 << (idx & 7))) !== 0;
}
