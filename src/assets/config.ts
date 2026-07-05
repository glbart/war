// Константы ассетов и геймплейных значений, общие для render/input/sim.
// Порт констант из reference/earth-nuke.html (TEX_W/TEX_H, YIELDS, URL текстур и тайлов).

import type { Biome } from '../sim/material';

export const TEX_W = 4096;
export const TEX_H = 2048;

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

export const EARTH_TEXTURE_URL =
  'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
export const EARTH_TOPO_URL = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';

export const TILE_IMAGERY_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const TILE_LABELS_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
