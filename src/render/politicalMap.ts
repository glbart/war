// Пиксели плоской политической карты (спека 2026-08-29-flat-map-design.md): реальные границы
// Natural Earth + заливка по сторонам игры. ЧИСТЫЙ TS без three.js — тестируется напрямую,
// а MapView только заливает результат в текстуру.

import {
  countryRaster,
  COUNTRIES_W,
  COUNTRIES_H,
  COUNTRIES_NONE,
  factionOfCountryIndex,
} from '../sim/countries';
import { factionById, type FactionId } from '../sim/factions';
import {
  MAP_WATER_COLOR,
  MAP_BORDER_COLOR,
  MAP_NEUTRAL_COLOR,
  MAP_FILL_MUTE,
  MAP_HIGHLIGHT,
} from '../assets/config';

export const MAP_W = COUNTRIES_W;
export const MAP_H = COUNTRIES_H;

function put(out: Uint8Array, i: number, rgb: readonly number[], scale = 1): void {
  out[i] = Math.max(0, Math.min(255, Math.round(rgb[0]! * 255 * scale)));
  out[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1]! * 255 * scale)));
  out[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2]! * 255 * scale)));
  out[i + 3] = 255;
}

// Строит RGBA-картинку карты: вода, заливка стран цветом их стороны, тёмные границы на стыке
// разных стран. highlight подсвечивает территорию выбранной стороны.
export function buildPoliticalPixels(highlight?: FactionId): Uint8Array {
  const raster = countryRaster();
  const out = new Uint8Array(MAP_W * MAP_H * 4);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const idx = y * MAP_W + x;
      const country = raster[idx]!;
      const o = idx * 4;

      if (country === COUNTRIES_NONE) {
        put(out, o, MAP_WATER_COLOR);
        continue;
      }

      // Граница: сосед справа или снизу принадлежит другой стране (долгота заворачивается).
      const right = raster[y * MAP_W + ((x + 1) % MAP_W)]!;
      const down = y + 1 < MAP_H ? raster[(y + 1) * MAP_W + x]! : country;
      if (right !== country || down !== country) {
        put(out, o, MAP_BORDER_COLOR);
        continue;
      }

      const faction = factionOfCountryIndex(country);
      const isNeutral = faction === undefined || faction === 'neutral';
      const color = isNeutral ? MAP_NEUTRAL_COLOR : factionById(faction).color;
      const scale = MAP_FILL_MUTE * (!isNeutral && faction === highlight ? MAP_HIGHLIGHT : 1);
      put(out, o, color, scale);
    }
  }
  return out;
}

// Обратная проекция: пиксель карты (u,v в 0..1) → долгота/широта в радианах.
export function mapUvToLonLat(u: number, v: number): { lon: number; lat: number } {
  const wrapped = u - Math.floor(u); // карта бесшовна по горизонтали
  return {
    lon: wrapped * 2 * Math.PI - Math.PI,
    lat: Math.PI / 2 - Math.min(1, Math.max(0, v)) * Math.PI,
  };
}

// Прямая проекция: направление на сфере → координаты на карте (u,v в 0..1).
export function lonLatToMapUv(lonRad: number, latRad: number): { u: number; v: number } {
  return {
    u: (lonRad + Math.PI) / (2 * Math.PI),
    v: (Math.PI / 2 - latRad) / Math.PI,
  };
}
