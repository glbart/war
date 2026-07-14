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
// Скорость волн: c²·dt²/dx² эффективный (стабильно < 0.5 для 4-соседей). 0.1 вместо 0.25 —
// волны от удара расходятся заметно медленнее (читаются глазом как кольца, а не мгновенная рябь).
export const WATER_WAVE_SPEED = 0.1;
export const WATER_WAVE_DAMPING = 0.006; // затухание СКОРОСТИ за шаг (рассеивает энергию волн)
// Затухание ВЫСОТЫ за шаг: без него односторонний импульс в скорость интегрируется в среднюю
// высоту, которая не спадает → всё поле уезжает от нуля и вырождается (белая пена / провал).
// Небольшой height-leak тянет поле к нулю (полный «возврат к штилю»). 0.003 вместо 0.02 —
// кольца волн живут секунды и успевают разойтись от эпицентра, дрейф среднего всё ещё гасится.
export const WATER_HEIGHT_DAMPING = 0.003;
// Импульс удара по воде в поле (по мощности): сила (в скорость, бьёт ВНИЗ — каверна) и радиус
// (доля equirect). Сила выбрана с запасом: каверна вниз всё равно клампится дном (OCEAN_ZBIAS),
// а видимую картину дают отдача-столб в центре и расходящиеся кольца — им нужна амплитуда.
// Не выше ~2.6: клампы поля ±4 превращают более сильную каверну в широкое плоское «блюдо».
export const WATER_SPLAT_STRENGTH: Record<number, number> = { 1: 0.9, 10: 1.6, 100: 2.6 };
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
// Оболочка приподнята над глобусом так, чтобы амплитуда волн (±~0.00128) не проваливала её ниже
// поверхности глобуса (r=1) во впадинах — иначе снизу проступает статичная биом-вода.
export const R_OCEAN = 1.0018;
export const OCEAN_ZBIAS = 0.0004; // минимальный гарантированный зазор оболочки над глобусом
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

// Баллистический выброс грунта при ударе по суше (EjectaView): число частиц на взрыв,
// начальная скорость (единицы радиуса/с) и «сила тяжести» параболы — по мощности заряда.
export const EJECTA_COUNT_BY_YIELD: Record<number, number> = { 1: 40, 10: 80, 100: 140 };
export const EJECTA_SPEED_BY_YIELD: Record<number, number> = { 1: 0.12, 10: 0.2, 100: 0.32 };
export const EJECTA_GRAVITY = 0.6; // «сила тяжести» параболы (единицы радиуса/с²)

// Процедурная детализация суши на зуме (дистанции камеры до поверхности; радиус планеты = 1).
export const DETAIL_NEAR = 2.0; // ближе — полная деталь
export const DETAIL_FAR = 3.6; // дальше — детали нет (как раньше)
export const DETAIL_ALBEDO_AMP = 0.16; // амплитуда вариации цвета
export const DETAIL_NORMAL_STR = 0; // [ЭКСПЕРИМЕНТ #2] временно 0 — изолируем detail-нормаль
export const DETAIL_FREQ = 60.0; // частота detail-шума (высокая — мелкая деталь)
export const DETAIL_OCTAVES = 3;

// Карта рельефа (bump) глобуса — единственная оставшаяся сетевая текстура (best-effort).
export const EARTH_TOPO_URL = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';

// Слой границ/подписей Esri поверх стилизованного глобуса (спутниковый слой снимков убран
// вместе с фичей материала — планета рисуется биом-картой, а не фото).
export const TILE_LABELS_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;

// ---------- Воксельная кора (спека 2026-07-06-voxel-crust-design.md) ----------
// Оболочка cube-sphere: 6 граней × N×N столбцов × D слоёв вглубь. Воксель ~1/15 диаметра
// кратера 100Мт. Чанки CH×CH×D ремешатся по отдельности (Surface Nets).
export const CRUST_FACE_N = 256; // столбцов по стороне грани
export const CRUST_DEPTH_LAYERS = 8; // слоёв вглубь
export const CRUST_CHUNK = 32; // сторона чанка в столбцах (256/32 = 8×8 чанков на грань)
export const CRUST_VOX_ANG = Math.PI / 2 / CRUST_FACE_N; // угловой размер вокселя у центра грани
export const CRUST_VOX_H = CRUST_VOX_ANG; // радиальная толщина слоя (≈кубический воксель)
export const MAGMA_R = 0.945; // радиус магма-сферы под корой (кора: 1 − 8·VOX_H ≈ 0.951)
// Радиус (рад) и глубина (в слоях) carve по мощности: 100Мт ≈ 15 вокселей в поперечнике.
export const CRUST_RADIUS_BY_YIELD: Record<number, number> = { 1: 0.009, 10: 0.022, 100: 0.046 };
export const CRUST_DEPTH_BY_YIELD: Record<number, number> = { 1: 1.5, 10: 3, 100: 5 };
// Палитра слоёв коры (r,g,b 0..1): порода/базальт/морское дно; грунт красится биомом.
export const CRUST_LAYER_COLORS = {
  rock: [0.32, 0.27, 0.23],
  basalt: [0.16, 0.14, 0.15],
  seabed: [0.08, 0.17, 0.26],
} as const;

// ---------- Обломки-глыбы (спека 2026-07-14-debris-design.md) ----------
// Слоты инстанс-буфера DebrisView двумя сегментами: орбитальные живут вечно (кольцо мусора,
// при переполнении вытесняется самая старая), баллистические переиспользуются по кольцу.
export const DEBRIS_ORBIT_SLOTS = 1536;
export const DEBRIS_BALLISTIC_SLOTS = 1024;
// Число глыб на удар: пропорция от выбитых вокселей с клампом (100Мт ≈ 590 вокселей → ~180).
export const DEBRIS_PER_VOXEL = 1 / 3;
export const DEBRIS_MIN = 8;
export const DEBRIS_MAX = 180;
export const DEBRIS_ORBIT_FRAC = 0.3; // доля глыб, уходящих на орбиту
export const DEBRIS_SPEED_BY_YIELD: Record<number, number> = { 1: 0.14, 10: 0.22, 100: 0.34 };
export const DEBRIS_ORBIT_R_MIN = 1.25; // орбитальный радиус кольца (радиус планеты = 1)
export const DEBRIS_ORBIT_R_MAX = 1.55;
export const DEBRIS_ASCENT_T = 6; // сек спирального взлёта с поверхности на орбиту
export const DEBRIS_OMEGA_MIN = 0.25; // рад/с — скорость кружения по орбите
export const DEBRIS_OMEGA_MAX = 0.6;
export const DEBRIS_SIZE_MIN = 0.006; // ~1 воксель коры (CRUST_VOX_H ≈ 0.0061)
export const DEBRIS_SIZE_MAX = 0.016;
export const DEBRIS_PUFF_MAX = 40; // лимит пыхов приземления на удар (бережём слоты EjectaView)
export const DEBRIS_SOIL_COLOR = [0.4, 0.31, 0.22] as const; // глыбы грунта (порода/базальт — CRUST_LAYER_COLORS)

// ---------- Трещины и целостность (спека 2026-07-14-cracks-integrity-design.md) ----------
// «Бюджет гибели» коры: выбитых вокселей, при которых integrity()=0 (порог раскола, этап 4).
// Честная доля всей коры (~912k вокселей суши) недостижима игрой — бюджет геймплейный:
// ~34 удара по 100 Мт (≈590 вокселей каждый).
export const CRUST_DOOM_VOXELS = 20_000;
export const CRACK_EXTENT_FRAC = 2.4; // докуда стелются трещины (доли радиуса штампа поля)
export const CRACK_FREQ = 26; // частота рисунка жил (ridged fbm по направлению фрагмента)
export const CRACK_EDGE0 = 0.86; // порог начала жилы (ширина линий: ближе к EDGE1 — тоньше)
export const CRACK_EDGE1 = 0.97;
export const CRACK_COLOR = [1.0, 0.42, 0.1] as const; // магма (согласовано с MagmaCore)
export const CRACK_INTENSITY = 1.6; // множитель эмиссии (перекрывает гарь-затемнение)
