// Константы ассетов и геймплейных значений, общие для render/input/sim.

import type { Biome } from '../sim/material';

// Стилизованная палитра биомов (r,g,b в 0..1).
export const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  ocean: [0.07, 0.19, 0.31],
  ice: [0.87, 0.91, 0.95],
  tundra: [0.49, 0.54, 0.46],
  desert: [0.79, 0.66, 0.42],
  grass: [0.37, 0.56, 0.31],
  forest: [0.18, 0.42, 0.2],
};

export const BIOME_TEX_W = 1024;
export const BIOME_TEX_H = 512;
export const DAMAGE_TEX_W = 2048;
export const DAMAGE_TEX_H = 1024;
export const GLOBE_LON_SEG = 384;
export const GLOBE_LAT_SEG = 192;
export const MAX_CRATER_DEPTH = 0.012; // доля радиуса планеты

export const YIELDS = [1, 10, 100] as const;
export type Yield = (typeof YIELDS)[number];

// Поправки на мощность взрыва для визуальных эффектов (размер/тайминг) — общие для
// ExplosionView (огненный шар/ударная волна) и WaterBurstView (купол/столб/кольцо), чтобы
// шкала "мощность → размер/время" была единообразной по всем эффектам взрыва.
export const YIELD_SIZE_SCALE: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };
export const YIELD_TIME_SCALE: Record<number, number> = { 1: 0.8, 10: 1.0, 100: 1.4 };

// Карта рельефа (bump) глобуса — единственная оставшаяся сетевая текстура (best-effort).
export const EARTH_TOPO_URL = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';

// Слой границ/подписей Esri поверх стилизованного глобуса (спутниковый слой снимков убран
// вместе с фичей материала — планета рисуется биом-картой, а не фото).
export const TILE_LABELS_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
