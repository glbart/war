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

// ---------- Раскол планеты (спека 2026-07-14-planet-shatter-design.md) ----------
export const SHATTER_AGONY_T = 4.5; // сек агонии (глобальный разгорающийся буст трещин)
export const SHATTER_SHARD_COUNT = 140; // крупных осколков раскола (орбитальный сегмент DebrisView)
export const SHATTER_SHARD_SIZE_MIN = 0.05;
export const SHATTER_SHARD_SIZE_MAX = 0.18;
export const SHATTER_SHARD_R_MIN = 1.05; // радиусы поля обломков вокруг ядра
export const SHATTER_SHARD_R_MAX = 1.9;
export const SHATTER_SHARD_OMEGA_MIN = 0.05; // рад/с — медленное кружение крупных осколков
export const SHATTER_SHARD_OMEGA_MAX = 0.2;
// Куски-плиты киношного разрыва (ревизия спеки §5): оболочка сферы бьётся Вороным на куски,
// которые в замедленном темпе разлетаются в стороны.
export const SHATTER_PLATE_COUNT = 14;
export const SHATTER_SHELL_INNER = 0.952; // внутренний радиус оболочки кусков (чуть выше магмы)
export const SHATTER_PLATE_SPEED_MIN = 0.05; // скорость разлёта куска (радиусов/с, после разгона)
export const SHATTER_PLATE_SPEED_MAX = 0.12;
export const SHATTER_PLATE_RAMP_T = 6; // сек разгона от нуля («замедленный режим»)
export const SHATTER_PLATE_SPIN_MAX = 0.25; // рад/с — максимум медленного кувыркания куска
// Распад ядра (ревизии спеки §6-7): от планеты не остаётся ничего; ядро НЕ висит целым —
// мелькает в щелях и рвётся на расплав (SPH-симуляции гигантских импактов).
export const SHATTER_CORE_LINGER_T = 1.2; // сек после раскола до разрыва ядра
export const SHATTER_CORE_COLLAPSE_T = 2.2; // сек вспышки и схлопывания ядра
export const SHATTER_ESCAPE_COUNT = 200; // обломков финального разлёта прочь
export const SHATTER_ESCAPE_R_MIN = 6; // «орбиты» разлёта — за секунды уходят из вида
export const SHATTER_ESCAPE_R_MAX = 14;
export const SHATTER_ESCAPE_SIZE_MIN = 0.01;
export const SHATTER_ESCAPE_SIZE_MAX = 0.05;
// Реалистичный распад (ревизия §7): капли расплава ядра/мантии + остывание всего горячего.
export const SHATTER_MOLTEN_COUNT = 320; // раскалённых фрагментов разрыва ядра
export const SHATTER_MOLTEN_R_MIN = 1.5; // облако расплава расширяется в этот диапазон
export const SHATTER_MOLTEN_R_MAX = 8;
export const SHATTER_MOLTEN_SIZE_MIN = 0.02;
export const SHATTER_MOLTEN_SIZE_MAX = 0.1;
export const SHATTER_COOL_TAU = 8; // сек — константа exp-остывания капель (бело-жёлтое → тьма)
export const SHATTER_COOL_T = 30; // сек — полное остывание срезов кусков-плит

// ---------- Баллистические МБР (спека 2026-07-14-ballistic-missiles-design.md) ----------
export const SALVO_COUNT = 6; // ракет в залпе (кнопка HUD)
export const BALLISTIC_APEX_MIN = 0.12; // апогей дуги (радиусов планеты) на нулевой дальности
export const BALLISTIC_APEX_SCALE = 0.5; // прибавка апогея: apex = MIN + SCALE·(угол/π)
export const BALLISTIC_TIME_MIN = 3; // сек полёта на нулевой дальности
export const BALLISTIC_TIME_SCALE = 5; // прибавка: T = MIN + SCALE·(угол/π)
export const BALLISTIC_EASE_POW = 1.6; // e = k^POW — медленный буст, быстрый вход в атмосферу
// След МБР (ревизия спеки §5): дуга пройденной траектории, тает после детонации.
export const TRAIL_SEGMENTS = 96; // вершин дуги следа − 1
export const TRAIL_FADE_T = 5; // сек затухания следа после детонации
// Радиус, с которого падает «удар из космоса» (ручной клик): общий для MissileView и
// расчёта точки перехвата в симуляции.
export const SPACE_STRIKE_START_R = 2.6;
export const TRAIL_COLOR = [1.0, 0.72, 0.42] as const; // цвет выхлопа (аддитивный)

// ---------- Страны и фракции (спека 2026-08-29-factions-design.md) ----------
// Разброс пусковых площадок вокруг города-«хозяина» (рад, ≈3°): ракеты стартуют с территории
// страны, а не из центра мегаполиса.
export const FACTION_LAUNCH_JITTER = 0.05;
// Маркеры городов (CityMarkersView): радиус посадки над поверхностью и шкала размера.
export const MARKER_R = 1.004;
export const MARKER_SIZE_MIN = 0.004;
export const MARKER_SIZE_MAX = 0.011;
export const MARKER_POP_REF = 20; // млн — население «крупного» города (верх шкалы размера)
// Опустошённый город не исчезает совсем: тёмная мелкая точка на месте агломерации.
export const MARKER_DEAD_SIZE_FRAC = 0.35;
export const MARKER_DEAD_COLOR_FRAC = 0.2;

// ---------- Дипломатия и ответный удар (спека 2026-08-29-retaliation-design.md) ----------
// Задержка реакции стороны на удар (сек): волны обмена читаются глазом, а не сливаются.
export const RETALIATION_DELAY_MIN = 3;
export const RETALIATION_DELAY_MAX = 6;
// Союзник вступается позже — добавка к задержке (сек).
export const ALLY_DELAY_EXTRA_MIN = 2;
export const ALLY_DELAY_EXTRA_MAX = 5;
// Соразмерность: одна боеголовка ответа на столько млн погибших.
export const RETALIATION_PER_DEATHS = 6;
// Потолок волны при эскалации/doomsday. Он же бережёт пул ракет рендера (24 слота).
export const RETALIATION_CAP_ESCALATE = 12;
// Доля от расчётного залпа, которой вступается союзник.
export const ALLY_RESPONSE_FRAC = 0.5;

// ---------- ПРО, эскалация, победа (спека 2026-08-29-abm-escalation-victory-design.md) ----------
// ПРО прикрывает свою территорию: перехват возможен, если цель ближе этого угла к живому
// городу стороны (рад; ~0.28 ≈ 1800 км).
export const ABM_COVER_ANGLE = 0.28;
// Доля времени полёта, на которой отрабатывает перехватчик (уже на подлёте — видно вспышку).
export const ABM_INTERCEPT_AT = 0.75;

// Лестница эскалации: 0 мир · 1 кризис · 2 ограниченная · 3 полномасштабная · 4 тотальная.
export const ESCALATION_MAX = 4;
export const ESCALATION_DECAY_T = 45; // сек затишья на снижение уровня пары
// Переговоры и перемирие.
export const TRUCE_T = 60; // сек, пока стороны не отвечают друг другу
export const PEACE_OFFER_TIMEOUT = 15; // сек на ответ игрока (молчание = отказ)
export const PEACE_COOLDOWN_T = 25; // сек между предложениями по одной паре
export const PEACE_HOLD_T = 30; // сек тишины при нулевых уровнях → исход «мир восстановлен»
// Ниже этой доли исходного населения сторона считается павшей (HUD и условия победы).
export const FALLEN_FRAC = 0.01;

// Вспышка перехвата (render/InterceptView): короткий расширяющийся всполох на точке работы ПРО.
export const INTERCEPT_SLOTS = 32;
export const INTERCEPT_FLASH_T = 0.7; // сек жизни вспышки
export const INTERCEPT_FLASH_SIZE = 0.05; // радиус в долях радиуса планеты
export const INTERCEPT_HIT_COLOR = [0.75, 0.9, 1.0] as const; // сбита — бело-голубая вспышка
export const INTERCEPT_MISS_COLOR = [1.0, 0.55, 0.25] as const; // промах — тусклый оранжевый

// ---------- Utility AI: принятие решений сторонами (спека 2026-08-29-utility-ai-design.md) ----------
export const AI_PULSE_T = 5; // сек между «раздумьями» стороны (стороны разнесены по фазам)
export const AI_ACTION_THRESHOLD = 0.2; // ниже этой оценки страна предпочтёт ничего не делать
export const AI_TOP_BAND = 0.85; // жребий бросается среди вариантов не хуже доли от лучшего
export const AI_INERTIA_BONUS = 1.15; // бонус прошлому выбору — страна не дёргается каждый пульс
export const AI_PAIN_REF = 0.25; // доля потерь населения, на которой «боль» насыщается
export const AI_GRIEVANCE_REF = 20; // млн погибших от конкретной стороны — насыщение обиды
export const GRIEVANCE_HALFLIFE = 120; // сек: за это время обида слабеет вдвое (страна отходит)
export const AI_TOP_KEEP = 3;
// Пауза между волнами одной страны (сек): без неё сторона капает по ракете каждый пульс,
// вместо того чтобы бить волнами.
export const AI_STRIKE_COOLDOWN = 25;
// Сколько «обиды» (млн погибших) гасит одна выпущенная в отместку боеголовка. Месть
// удовлетворяет: иначе один удар питает бесконечную череду ответов.
export const GRIEVANCE_SETTLED_PER_WARHEAD = 6; // сколько лучших вариантов отдавать наружу для панели «почему»

// ---------- Режим «Нераспространение» (спека 2026-08-29-nonproliferation-design.md) ----------
export const CAMPAIGN_T = 600; // сек партии: дожить до конца, не дав никому новую бомбу
export const PROLIF_LOSS_COUNT = 3; // столько новых ядерных держав — поражение
// Влияние — политический капитал игрока: капает со временем, тратится на инструменты.
export const INFLUENCE_START = 60;
export const INFLUENCE_RATE = 1.2; // в секунду
export const COST_TREATY = 25;
export const COST_SANCTIONS = 15;
export const COST_INSPECT = 8;
export const COST_SABOTAGE = 30;
export const INFLUENCE_STRIKE_PENALTY = 40; // мир осуждает удар по неядерной стране
// Ядерная программа претендента.
export const PROGRAM_BASE_RATE = 0.05; // прогресс стадии в секунду при мотивации и потенциале = 1
export const PROGRAM_STAGES = 3; // research → enrichment → weapon (после — испытание)
export const PROGRAM_START_MOTIVATION = 0.25; // ниже этого страна даже не начинает
export const SANCTION_SLOWDOWN = 0.35; // множитель скорости под санкциями
export const SANCTION_T = 120; // сек действия санкций
export const TREATY_T = 180; // сек заморозки программы по договору
export const SABOTAGE_SUCCESS = 0.65; // шанс удачного саботажа
export const SABOTAGE_SETBACK_MIN = 0.3; // откат прогресса при удаче
export const SABOTAGE_SETBACK_MAX = 0.6;
export const SUSPICION_REVEAL = 0.5; // выше этого порога программа считается подтверждённой
export const CASCADE_MOTIVATION = 0.15; // чужое испытание подстёгивает всех остальных
export const NEW_POWER_ARSENAL = 4; // боеголовок у страны, дошедшей до испытания
export const NEW_POWER_INTERCEPTORS = 2;

// ---------- Глубокая симуляция (спека 2026-08-29-deep-simulation-design.md) ----------
// Экономика: индекс 0..1 даёт доход, доход копится в бюджет, бюджет кормит программу.
export const ECONOMY_INCOME = 2.0; // единиц бюджета в секунду при индексе 1
export const ECONOMY_RECOVERY = 0.02; // скорость возврата индекса к его потолку
export const SANCTION_ECONOMY_HIT = 0.012; // падение индекса в секунду под санкциями
export const SANCTION_SELF_COST = 0.004; // и сам инициатор платит за каждую активную санкцию
// Стоимость работ подобрана по доходу: средняя экономика (индекс ~0.3) тянет программу,
// но санкции роняют индекс ниже линии финансирования — и работы начинают глохнуть сами.
export const PROGRAM_COST_RATE = 0.5;
export const PROGRAM_STARVED_RATE = 0.25; // множитель скорости, когда денег нет
// ООН: резолюции и голосование ядерных держав.
export const COST_RESOLUTION = 10;
export const UN_SUPPORT_FOR = 0.55; // выше — голос «за»
export const UN_SUPPORT_AGAINST = 0.35; // ниже — голос «против»
export const COALITION_SANCTION_FACTOR = 2; // коалиционные санкции бьют вдвое сильнее
export const RESOLUTION_COOLDOWN_T = 45; // сек между резолюциями по одной цели
// Гарантии безопасности.
export const COST_GUARANTEE = 20; // разовая цена оформления зонтика
export const GUARANTEE_UPKEEP = 0.5; // влияния в секунду за каждый действующий зонтик
export const GUARANTEE_MOTIVATION_FLOOR = 0.12; // к чему тянется мотивация под зонтиком
export const GUARANTEE_BREAK_SPIKE = 0.25; // брошенный союзник бежит за бомбой
// Шпионаж.
export const COST_RECON = 6;
export const RECON_GAIN = 0.4;
export const INTEL_DECAY = 0.004; // в секунду
export const SPONSOR_REVEAL = 0.6; // с какого уровня осведомлённости видно спонсора
export const PROGRESS_NOISE_SCALE = 0.25; // максимум шума в показанном прогрессе
// Спонсорство чужих программ соперниками игрока.
export const SPONSOR_SPEEDUP = 1.6;
export const SPONSOR_MONEY_RATE = 1.6; // спонсор оплачивает работы подопечного
export const SPONSOR_MIN_DESIRE = 0.45; // ниже этого держава не станет спонсировать
