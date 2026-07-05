import { isLand } from './landmask';
import { dirToLonLat, type Vec3 } from './geo';

export type Surface = 'land' | 'water' | 'ice';
export type Biome = 'ocean' | 'ice' | 'tundra' | 'desert' | 'grass' | 'forest';
export interface Material {
  surface: Surface;
  biome: Biome;
}

// Детерминированный value-noise по направлению (без Math.random): хэш-функция на sin,
// диапазон примерно [-1, 1]. Даёт пятнистость границ биомов, воспроизводимую между запусками.
function noiseAt(lonRad: number, latRad: number): number {
  const s = Math.sin(lonRad * 12.9898 + latRad * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// Биом суши по широте + шум-джиттер границ (±6°). Полярная суша трактуется как лёд.
export function biomeForLand(latRad: number, noise: number): Biome {
  const a = Math.abs(latRad) * (180 / Math.PI) + noise * 6;
  if (a > 66) return 'ice';
  if (a > 52) return 'tundra';
  if (a >= 18 && a <= 34) return 'desert';
  if (a < 12) return 'forest';
  return 'grass';
}

// Классификация точки на сфере: вода вне суши; на суше — биом по правилам, лёд → surface 'ice'.
export function materialAt(lonRad: number, latRad: number): Material {
  if (!isLand(lonRad, latRad)) return { surface: 'water', biome: 'ocean' };
  const biome = biomeForLand(latRad, noiseAt(lonRad, latRad));
  return { surface: biome === 'ice' ? 'ice' : 'land', biome };
}

export function materialAtDir(dir: Vec3): Material {
  const { lon, lat } = dirToLonLat(dir);
  return materialAt(lon, lat);
}
