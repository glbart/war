// Процедурная equirect биом-текстура: для каждого пикселя (px,py) → (lon,lat) в конвенции
// lonLatToDir, классификация materialAt, цвет из biomeRGB + лёгкий шум яркости для детализации.
// Строится один раз при старте (canvas → CanvasTexture в GlobeView).
import { materialAt } from '../sim/material';
import { biomeRGB } from './biome';
import { BIOME_TEX_W, BIOME_TEX_H } from '../assets/config';

export function buildBiomeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = BIOME_TEX_W;
  canvas.height = BIOME_TEX_H;
  const c2d = canvas.getContext('2d')!;
  const img = c2d.createImageData(BIOME_TEX_W, BIOME_TEX_H);
  for (let py = 0; py < BIOME_TEX_H; py++) {
    const lat = Math.PI / 2 - (py / BIOME_TEX_H) * Math.PI;
    for (let px = 0; px < BIOME_TEX_W; px++) {
      const lon = (px / BIOME_TEX_W) * 2 * Math.PI - Math.PI;
      const [r, g, b] = biomeRGB(materialAt(lon, lat).biome);
      // детерминированный шум яркости ±8%
      const n = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
      const j = 1 + ((n - Math.floor(n)) * 2 - 1) * 0.08;
      const o = (py * BIOME_TEX_W + px) * 4;
      img.data[o] = Math.min(255, r * 255 * j);
      img.data[o + 1] = Math.min(255, g * 255 * j);
      img.data[o + 2] = Math.min(255, b * 255 * j);
      img.data[o + 3] = 255;
    }
  }
  c2d.putImageData(img, 0, 0);
  return canvas;
}
