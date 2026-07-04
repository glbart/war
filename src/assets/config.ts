// Константы ассетов и геймплейных значений, общие для render/input/sim.
// Порт констант из reference/earth-nuke.html (TEX_W/TEX_H, YIELDS, URL текстур и тайлов).

export const TEX_W = 4096;
export const TEX_H = 2048;

export const YIELDS = [1, 10, 100] as const;
export type Yield = (typeof YIELDS)[number];

export const EARTH_TEXTURE_URL =
  'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
export const EARTH_TOPO_URL = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';

export const TILE_IMAGERY_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const TILE_LABELS_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
