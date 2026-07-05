import { BIOME_COLORS } from '../assets/config';
import type { Biome } from '../sim/material';

// Базовый цвет биома (r,g,b в 0..1). Отдельная функция — точка тюнинга и юнит-тестируемости
// без three.js.
export function biomeRGB(biome: Biome): [number, number, number] {
  return BIOME_COLORS[biome];
}
