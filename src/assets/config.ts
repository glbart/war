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
// Разрешение вспомогательных equirect-текстур океана (маска берега / волновое поле).
export const COAST_TEX_W = 1024;
export const COAST_TEX_H = 512;

// Волновое поле океана (интерактивная рябь/каверна). Разрешение делит COAST для простоты.
export const WATER_FIELD_W = 1024;
export const WATER_FIELD_H = 512;
export const WATER_WAVE_SPEED = 0.25; // c²·dt²/dx² эффективный (стабильно < 0.5 для 4-соседей)
export const WATER_WAVE_DAMPING = 0.006; // затухание за шаг → поле само возвращается к штилю
// Импульс удара по воде в поле (по мощности): сила (в скорость) и радиус (доля equirect).
export const WATER_SPLAT_STRENGTH: Record<number, number> = { 1: 0.6, 10: 1.1, 100: 1.9 };
export const WATER_SPLAT_RADIUS: Record<number, number> = { 1: 0.012, 10: 0.02, 100: 0.035 };
export const GLOBE_LON_SEG = 384;
export const GLOBE_LAT_SEG = 192;
export const MAX_CRATER_DEPTH = 0.012; // доля радиуса планеты

// Профиль кратера суши (в долях радиуса чаши uRadius): где вал, его ширина, докуда эжекта/гарь.
export const CRATER_RIM_FRAC = 1.18; // центр кольца-вала (снаружи чаши)
export const CRATER_RIM_WIDTH_FRAC = 0.28; // полуширина гаусса вала
export const CRATER_EJECTA_FRAC = 2.6; // докуда стелется выброс
export const CRATER_SCORCH_FRAC = 2.0; // радиус мягкого гарь-градиента (шире чаши)
export const CRATER_RIM_HEIGHT = 0.006; // высота вала над поверхностью (доля радиуса планеты)

// Зоны материала кратера суши (colorNode GlobeView): цвета по возрастанию «жёсткости» к центру.
// Гарь — мягкий градиент потемнения биома (не слэб), выброс/пыль — присыпка на валу, обнажённая
// порода — на склоне чаши, оплавленное стекло — в самом центре. Значения (r,g,b в 0..1) —
// стартовые, финальную настройку делает пользователь визуально.
export const CRATER_MATERIAL_COLORS = {
  scorch: [0.12, 0.1, 0.08], // мягкая гарь (по каналу G)
  dust: [0.42, 0.38, 0.32], // выброс/пыль на кольце вала (по каналу A)
  rock: [0.28, 0.24, 0.21], // обнажённая порода на склоне чаши (средний R)
  glass: [0.1, 0.09, 0.11], // оплавленное стекло в центре (высокий R)
} as const;

// Микрорельеф нормали в damaged-зоне (procedural fbm по positionLocal): вал/стенки ловят
// статичный свет сцены. OCTAVES — число октав fbm; STRENGTH — доля подмешивания возмущённой
// нормали к базовой (топо-bump) под маской (R+A). Подбор силы — в визуальной приёмке.
export const CRATER_DETAIL_OCTAVES = 3;
export const CRATER_DETAIL_STRENGTH = 0.7;

// Водная оболочка океана (OceanShell): анимированная сфера чуть выше глобуса.
export const R_OCEAN = 1.0008; // чуть выше глобуса (r=1) — против z-fighting с ocean-цветом
export const OCEAN_LON_SEG = 384;
export const OCEAN_LAT_SEG = 192;
// Константное направление «солнца» для ручного шейдинга воды (без динамического света).
export const OCEAN_SUN_DIR: [number, number, number] = [0.55, 0.65, 0.52];

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
