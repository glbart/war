# Материал поверхности и разрушаемость — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать планете понятие материала (суша/вода/лёд + биом), геометрически разрушать сушу накопительным GPU-полем урона, показывать подводный взрыв на воде и заменить фотоснимок стилизованной биом-картой (подписи остаются).

**Architecture:** Материал — авторитетный факт в чистом слое `sim` (`materialAt`), едет в событии `explosionStarted`. Рендер строит стилизованный глобус из landmask+правил биомов, копит воронки в equirect-текстуре урона (splat на детонацию), вдавливает поверхность в вершинном TSL-шейдере и маршрутизирует визуал взрыва по `surface`.

**Tech Stack:** Vite + TypeScript (strict) + three.js 0.185 (`three/webgpu`, TSL-узлы, WebGPU+откат WebGL2) + miniplex + Vitest.

## Global Constraints

- **Язык общения — русский**; комментарии в коде — русские (как в существующем коде).
- **`sim`/`ecs` НЕ импортируют `render`/`ui`/`input`** — чистые, headless-тестируемые.
- **Никакого динамического света** (запрещён `PointLight` на взрыв — источник лагов эталона).
- **Только TSL-узлы**, без сырого GLSL/WGSL — код компилируется в оба бэкенда.
- **Никаких аллокаций/GC на кадр** в горячих путях: всё эфемерное — из пулов, векторы переиспользуются.
- **Seeded RNG**, никакого `Math.random()` в `sim`.
- Проверки: `npm test` (Vitest), `npm run lint` (eslint+prettier), `npm run build` (tsc+vite) — все зелёные перед коммитом.
- Мощности заряда — строго `YIELDS = [1, 10, 100]` (тип `Yield`).
- Ось-конвенция сферы: `lonLatToDir(lon,lat) = {x: cosLat·cosLon, y: sinLat, z: -cosLat·sinLon}`. Equirect-UV: `u=(lon+π)/2π`, `v=(π/2−lat)/π`.

---

## Фаза A — Материал в `sim` (чистая логика, TDD)

### Task 1: Обратная проекция `dirToLonLat`

**Files:**
- Modify: `src/sim/geo.ts`
- Test: `test/sim/geo.test.ts`

**Interfaces:**
- Produces: `dirToLonLat(dir: Vec3): { lon: number; lat: number }` — обратна `lonLatToDir`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `test/sim/geo.test.ts` (импорт `dirToLonLat` в существующий импорт-блок):

```ts
it('dirToLonLat обратна lonLatToDir', () => {
  for (const [lon, lat] of [
    [0, 0],
    [1.2, -0.5],
    [-2.7, 1.1],
    [Math.PI - 0.01, 0.3],
  ] as const) {
    const d = lonLatToDir(lon, lat);
    const r = dirToLonLat(d);
    expect(r.lon).toBeCloseTo(lon, 6);
    expect(r.lat).toBeCloseTo(lat, 6);
  }
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- geo`
Expected: FAIL — `dirToLonLat is not a function`.

- [ ] **Step 3: Реализовать**

Добавить в конец `src/sim/geo.ts`:

```ts
// Обратна lonLatToDir: широта из y, долгота из atan2(-z, x) (та же ось-конвенция).
export function dirToLonLat(dir: Vec3): { lon: number; lat: number } {
  return { lon: Math.atan2(-dir.z, dir.x), lat: Math.asin(clamp(dir.y, -1, 1)) };
}
```

- [ ] **Step 4: Запустить — проходит**

Run: `npm test -- geo`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/sim/geo.ts test/sim/geo.test.ts
git commit -m "feat(geo): dirToLonLat — обратная проекция вектора в lon/lat"
```

---

### Task 2: Landmask реальных материков

Грубая маска суша/вода реальной Земли, доступная чистому `sim`. Реализуем как **запечённую
low-res растровую маску** в data-модуле + декодер. Генератор офлайн (см. Step 6) читает
public-domain equirect land/sea PNG и паковывает биты; результат коммитится и в рантайме не
требует сети.

**Files:**
- Create: `src/sim/landmask.data.ts` (генерируется скриптом; временно — заглушка, см. ниже)
- Create: `src/sim/landmask.ts`
- Create: `scripts/gen-landmask.mjs`
- Test: `test/sim/landmask.test.ts`
- Modify: `package.json` (скрипт `gen:landmask`, devDep `pngjs`)

**Interfaces:**
- Produces: `LANDMASK_W: number`, `LANDMASK_H: number` (из `landmask.data.ts`)
- Produces: `isLand(lonRad: number, latRad: number): boolean` (из `landmask.ts`)

- [ ] **Step 1: Написать падающий тест**

`test/sim/landmask.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isLand } from '../../src/sim/landmask';

const D = Math.PI / 180;

describe('landmask', () => {
  it('Сахара — суша', () => {
    expect(isLand(15 * D, 23 * D)).toBe(true);
  });
  it('центр Тихого океана — вода', () => {
    expect(isLand(-140 * D, 0)).toBe(false);
  });
  it('Антарктида — суша', () => {
    expect(isLand(0, -82 * D)).toBe(true);
  });
  it('Атлантика между Африкой и Ю.Америкой — вода', () => {
    expect(isLand(-20 * D, -5 * D)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- landmask`
Expected: FAIL — модуль `landmask` не найден.

- [ ] **Step 3: Декодер `landmask.ts`**

Формат `landmask.data.ts`: экспортирует `LANDMASK_W`, `LANDMASK_H` и `LANDMASK_BITS_B64` —
base64 упакованного bitset (1 бит/пиксель, ряд за рядом, `py=0` — северный полюс, `px=0` — lon=−180).

```ts
import { LANDMASK_W, LANDMASK_H, LANDMASK_BITS_B64 } from './landmask.data';

// Ленивое декодирование base64 → Uint8Array bitset (Node и браузер: atob есть в обоих
// современных рантаймах; в Node ≥16 — глобальный).
let bits: Uint8Array | null = null;
function getBits(): Uint8Array {
  if (bits) return bits;
  const bin = atob(LANDMASK_BITS_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  bits = out;
  return out;
}

// Суша ли в точке (lonRad ∈ [-π,π], latRad ∈ [-π/2,π/2]). Equirect-сэмпл ближайшего пикселя.
export function isLand(lonRad: number, latRad: number): boolean {
  const u = (lonRad + Math.PI) / (2 * Math.PI);
  const v = (Math.PI / 2 - latRad) / Math.PI;
  const px = Math.min(LANDMASK_W - 1, Math.max(0, Math.floor(u * LANDMASK_W)));
  const py = Math.min(LANDMASK_H - 1, Math.max(0, Math.floor(v * LANDMASK_H)));
  const idx = py * LANDMASK_W + px;
  return (getBits()[idx >> 3]! & (1 << (idx & 7))) !== 0;
}
```

- [ ] **Step 4: Генератор `scripts/gen-landmask.mjs`**

Читает локальный equirect land/sea PNG (`scripts/assets/landmask-src.png`), даунсемплит до
`W×H`, бинаризует по яркости, паковывает в bitset, base64, пишет `src/sim/landmask.data.ts`.

```js
// Запуск: npm run gen:landmask
// Источник scripts/assets/landmask-src.png — public-domain equirect маска суша(белое)/вода(чёрное),
// например экспортированная из Natural Earth 1:110m. Скачивается вручную один раз.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const W = 512, H = 256;
const png = PNG.sync.read(readFileSync('scripts/assets/landmask-src.png'));
const bitset = new Uint8Array(Math.ceil((W * H) / 8));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = Math.floor((x / W) * png.width);
    const sy = Math.floor((y / H) * png.height);
    const o = (sy * png.width + sx) * 4;
    const lum = (png.data[o] + png.data[o + 1] + png.data[o + 2]) / 3;
    if (lum > 110) {
      const idx = y * W + x;
      bitset[idx >> 3] |= 1 << (idx & 7);
    }
  }
}
const b64 = Buffer.from(bitset).toString('base64');
writeFileSync(
  'src/sim/landmask.data.ts',
  `// АВТОГЕНЕРАЦИЯ scripts/gen-landmask.mjs — не править вручную.\n` +
    `export const LANDMASK_W = ${W};\nexport const LANDMASK_H = ${H};\n` +
    `export const LANDMASK_BITS_B64 = '${b64}';\n`,
);
console.log('landmask.data.ts записан');
```

Добавить в `package.json` scripts: `"gen:landmask": "node scripts/gen-landmask.mjs"`, и
`pngjs` в devDependencies (`npm i -D pngjs`).

- [ ] **Step 5: Сгенерировать данные**

Скачать public-domain equirect маску суша/вода в `scripts/assets/landmask-src.png` (белое —
суша, чёрное — вода; при инверсии поменять порог), затем:

Run: `npm run gen:landmask`
Expected: создан `src/sim/landmask.data.ts` с непустым `LANDMASK_BITS_B64`.

> **Фолбэк офлайн (если PNG недоступен):** временно сгенерировать `landmask.data.ts` вручную из
> процедурной заглушки (грубые эллипсы материков) — материки настоящие лишь примерно, но тесты
> Step 1 должны пройти; заменить на растровую маску позже. Не оставлять пустой bitset.

- [ ] **Step 6: Запустить — проходит**

Run: `npm test -- landmask`
Expected: PASS (все 4 репера).

- [ ] **Step 7: Коммит**

```bash
git add src/sim/landmask.ts src/sim/landmask.data.ts scripts/gen-landmask.mjs package.json package-lock.json test/sim/landmask.test.ts
git commit -m "feat(sim): landmask реальных материков (запечённая маска + генератор)"
```

---

### Task 3: Классификатор материала `materialAt`

**Files:**
- Create: `src/sim/material.ts`
- Test: `test/sim/material.test.ts`

**Interfaces:**
- Consumes: `isLand` (Task 2), `dirToLonLat` (Task 1), `Vec3` (`sim/geo`)
- Produces:
  - `type Surface = 'land' | 'water' | 'ice'`
  - `type Biome = 'ocean' | 'ice' | 'tundra' | 'desert' | 'grass' | 'forest'`
  - `interface Material { surface: Surface; biome: Biome }`
  - `biomeForLand(latRad: number, noise: number): Biome` (чистая, экспортируется для тестов)
  - `materialAt(lonRad: number, latRad: number): Material`
  - `materialAtDir(dir: Vec3): Material`

- [ ] **Step 1: Написать падающий тест**

`test/sim/material.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { biomeForLand, materialAt, materialAtDir } from '../../src/sim/material';
import { lonLatToDir } from '../../src/sim/geo';

const D = Math.PI / 180;

describe('biomeForLand (правила, без шума)', () => {
  it('экватор — лес', () => expect(biomeForLand(5 * D, 0)).toBe('forest'));
  it('~25° — пустыня', () => expect(biomeForLand(25 * D, 0)).toBe('desert'));
  it('~40° — степь', () => expect(biomeForLand(40 * D, 0)).toBe('grass'));
  it('~60° — тундра', () => expect(biomeForLand(60 * D, 0)).toBe('tundra'));
  it('~72° — лёд', () => expect(biomeForLand(72 * D, 0)).toBe('ice'));
});

describe('materialAt', () => {
  it('океан — вода/ocean', () => {
    const m = materialAt(-140 * D, 0);
    expect(m.surface).toBe('water');
    expect(m.biome).toBe('ocean');
  });
  it('Сахара — суша/пустыня', () => {
    const m = materialAt(15 * D, 23 * D);
    expect(m.surface).toBe('land');
    expect(m.biome).toBe('desert');
  });
  it('Антарктида — лёд', () => {
    const m = materialAt(0, -82 * D);
    expect(m.surface).toBe('ice');
    expect(m.biome).toBe('ice');
  });
  it('детерминизм', () => {
    expect(materialAt(1.1, 0.4)).toEqual(materialAt(1.1, 0.4));
  });
  it('materialAtDir согласован с materialAt', () => {
    const dir = lonLatToDir(0.7, -0.2);
    expect(materialAtDir(dir)).toEqual(materialAt(0.7, -0.2));
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- material`
Expected: FAIL — модуль `material` не найден.

- [ ] **Step 3: Реализовать `src/sim/material.ts`**

```ts
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
```

- [ ] **Step 4: Запустить — проходит**

Run: `npm test -- material`
Expected: PASS. Если репер Сахара/Антарктида не сходится — проверить ориентацию `landmask-src.png`
(инверсия суша/вода или зеркалирование по Y), перегенерировать Task 2 Step 5.

- [ ] **Step 5: Коммит**

```bash
git add src/sim/material.ts test/sim/material.test.ts
git commit -m "feat(sim): materialAt — классификация суша/вода/лёд + биом по правилам"
```

---

### Task 4: Материал в событии `explosionStarted`

**Files:**
- Modify: `src/sim/events.ts`
- Modify: `src/sim/Simulation.ts:114-134` (`runMissiles`)
- Test: `test/sim/simulation.test.ts`

**Interfaces:**
- Consumes: `materialAtDir` (Task 3), `Surface`/`Biome` (Task 3)
- Produces: событие `{ kind: 'explosionStarted'; id; dir; yield; seed; surface: Surface; biome: Biome }`

- [ ] **Step 1: Написать падающий тест**

Добавить в `test/sim/simulation.test.ts` (импортировать `lonLatToDir` при необходимости):

```ts
it('детонация над океаном даёт surface=water в explosionStarted', () => {
  const sim = new Simulation(1);
  const dir = lonLatToDir(-140 * (Math.PI / 180), 0); // центр Тихого
  sim.step(0, [{ kind: 'detonate', dir, yield: 10 }]);
  const events = sim.step(3, []); // за FLIGHT_TIME=2.6 боеголовка долетает
  const boom = events.find((e) => e.kind === 'explosionStarted');
  expect(boom).toBeDefined();
  expect(boom && 'surface' in boom && boom.surface).toBe('water');
});
```

(Проверить фактический импорт `Simulation`/`lonLatToDir` в файле — при отсутствии добавить.)

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- simulation`
Expected: FAIL — у события нет `surface` (тип) или значение `undefined`.

- [ ] **Step 3: Расширить тип события**

`src/sim/events.ts` — заменить строку `explosionStarted`:

```ts
import type { Vec3 } from './geo';
import type { Surface, Biome } from './material';

export type SimEvent =
  | { kind: 'missileLaunched'; id: number; dir: Vec3; yield: number }
  | { kind: 'explosionStarted'; id: number; dir: Vec3; yield: number; seed: number; surface: Surface; biome: Biome }
  | { kind: 'cityHit'; name: string; deaths: number; atWaveTime: number }
  | { kind: 'planetReset' }
  | { kind: 'statsChanged'; bombs: number; megatons: number; deaths: number }
  | { kind: 'labelsToggled'; enabled: boolean };
```

- [ ] **Step 4: Классифицировать в `Simulation`**

`src/sim/Simulation.ts` — добавить импорт `import { materialAtDir } from './material';`, затем
в `runMissiles` заменить push `explosionStarted`:

```ts
const { surface, biome } = materialAtDir(w.dir);
events.push({ kind: 'explosionStarted', id, dir: w.dir, yield: w.yield, seed: w.seed, surface, biome });
```

- [ ] **Step 5: Запустить — проходит (и весь пакет)**

Run: `npm test`
Expected: PASS. Здесь же TS может указать на `Scene.handleEvent` — это Task 9; на этом шаге
Scene ещё компилируется (лишние поля события игнорируются). Если `npm run build` ругается на
неиспользуемые импорты — исправить точечно.

- [ ] **Step 6: Коммит**

```bash
git add src/sim/events.ts src/sim/Simulation.ts test/sim/simulation.test.ts
git commit -m "feat(sim): explosionStarted несёт surface/biome (авторитетный материал)"
```

---

## Фаза B — Стилизованный биом-глобус (рендер)

### Task 5: Палитра биомов и общий цвет

**Files:**
- Modify: `src/assets/config.ts`
- Create: `src/render/biome.ts`
- Test: `test/render/biome.test.ts`

**Interfaces:**
- Produces (config): `BIOME_COLORS: Record<Biome, [number, number, number]>` (r,g,b в 0..1),
  `DAMAGE_TEX_W/H`, `GLOBE_LON_SEG`, `GLOBE_LAT_SEG`, `MAX_CRATER_DEPTH`, `BIOME_TEX_W/H`
- Produces (biome.ts): `biomeRGB(biome: Biome): [number, number, number]`

- [ ] **Step 1: Написать падающий тест**

`test/render/biome.test.ts` (чистый — three.js не тянет):

```ts
import { describe, it, expect } from 'vitest';
import { biomeRGB } from '../../src/render/biome';

describe('biomeRGB', () => {
  it('океан синеватый (b > r)', () => {
    const [r, , b] = biomeRGB('ocean');
    expect(b).toBeGreaterThan(r);
  });
  it('пустыня тёплая (r > b)', () => {
    const [r, , b] = biomeRGB('desert');
    expect(r).toBeGreaterThan(b);
  });
  it('лёд светлый (все каналы > 0.8)', () => {
    expect(biomeRGB('ice').every((c) => c > 0.8)).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- biome`
Expected: FAIL — модуль `biome` не найден.

- [ ] **Step 3: Константы в `config.ts`**

Добавить в `src/assets/config.ts`:

```ts
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
```

- [ ] **Step 4: Реализовать `src/render/biome.ts`**

```ts
import { BIOME_COLORS } from '../assets/config';
import type { Biome } from '../sim/material';

// Базовый цвет биома (r,g,b в 0..1). Отдельная функция — точка тюнинга и юнит-тестируемости
// без three.js.
export function biomeRGB(biome: Biome): [number, number, number] {
  return BIOME_COLORS[biome];
}
```

- [ ] **Step 5: Запустить — проходит**

Run: `npm test -- biome`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/assets/config.ts src/render/biome.ts test/render/biome.test.ts
git commit -m "feat(render): палитра биомов + biomeRGB, константы глобуса/поля урона"
```

---

### Task 6: Биом-текстура глобуса вместо фотоснимка

Заменяем базу глобуса (Blue Marble) на процедурную биом-текстуру, построенную из `materialAt`.
Спутниковый слой тайлов убираем; подписи остаются.

**Files:**
- Create: `src/render/MaterialGlobe.ts`
- Modify: `src/render/GlobeView.ts` (использовать биом-текстуру как `map`, убрать загрузку Blue Marble)
- Modify: `src/render/TileLayers.ts:68-95` (удалить слой `imagery`)

**Interfaces:**
- Consumes: `materialAt` (Task 3), `biomeRGB` (Task 5), `BIOME_TEX_W/H` (Task 5)
- Produces: `buildBiomeCanvas(): HTMLCanvasElement` (в `MaterialGlobe.ts`)

- [ ] **Step 1: Реализовать `src/render/MaterialGlobe.ts`**

```ts
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
```

- [ ] **Step 2: Подставить в `GlobeView`**

В `src/render/GlobeView.ts`: импортировать `buildBiomeCanvas`. В `loadTexture` — вместо
`loadEarthImage()`/`drawProceduralEarth` использовать `buildBiomeCanvas()` как источник canvas
(Blue Marble/`EARTH_TEXTURE_URL` больше не грузим). Bump-карту `EARTH_TOPO_URL` можно оставить
(мягкий рельеф) или убрать — на выбор; при удалении убрать неиспользуемый импорт. `readyPromise`
резолвится сразу после установки биом-текстуры.

```ts
// внутри loadTexture, заменяя блок с img:
const canvas = buildBiomeCanvas();
const tex = new THREE.CanvasTexture(canvas);
tex.colorSpace = THREE.SRGBColorSpace;
tex.anisotropy = ctx.renderer.getMaxAnisotropy();
earthMaterial.map = tex;
earthMaterial.needsUpdate = true;
```

- [ ] **Step 3: Убрать спутниковый слой в `TileLayers`**

В `src/render/TileLayers.ts` удалить объект слоя `imagery` из массива `this.layers` (оставить
только `labels`), удалить создание `tilesGroup` и связанные строки. Импорт `TILE_IMAGERY_URL`
убрать.

- [ ] **Step 4: Проверка сборки/линта**

Run: `npm run build && npm run lint`
Expected: без ошибок (нет неиспользуемых импортов).

- [ ] **Step 5: Визуальная проверка (headless-скриншот)**

Запустить dev и снять скриншот глобуса (метод проекта из Task 10 отчёта — headless Chrome,
`http://localhost:5173`). Ожидаемо: планета — стилизованная заливка с узнаваемыми материками
(зелёные леса у экватора, песочные пояса ~30°, белые полюса, синий океан); подписи городов
поверх на месте. Спутниковых снимков нет ни на каком зуме.

Run: `npm run dev` (в фоне) + скриншот-скрипт.
Expected: биом-глобус + подписи, без ошибок консоли на обоих бэкендах.

- [ ] **Step 6: Коммит**

```bash
git add src/render/MaterialGlobe.ts src/render/GlobeView.ts src/render/TileLayers.ts
git commit -m "feat(render): стилизованный биом-глобус вместо фото; убран спутниковый слой"
```

---

## Фаза C — Поле урона и геометрическая деформация

### Task 7: Поле урона `DamageField` со splat

Equirect render-target урона + разовый splat воронки на детонацию.

**Files:**
- Create: `src/render/DamageField.ts`
- Test: визуальная (dev-хук)

**Interfaces:**
- Consumes: `ThreeCtx`, `dirToLonLat` (Task 1), `DAMAGE_TEX_W/H` (Task 5), `Vec3`
- Produces: класс `DamageField` с
  - `readonly texture: THREE.Texture` (текущее поле для чтения материалом глобуса)
  - `splat(dir: Vec3, yieldMt: number, kind: 'land' | 'ice'): void`
  - `clear(): void`

- [ ] **Step 1: Реализовать `src/render/DamageField.ts`**

Подход: отдельная орто-сцена с квадом-«штампом»; на `splat` рисуем мягкий профиль в позицию UV
эпицентра в `RenderTarget`, накапливая через `MAX`-блендинг по глубине. Читатель (глобус)
получает `renderTarget.texture`.

```ts
// Накопительное equirect-поле урона планеты. R=глубина воронки, G=гарь, B=оплавление/полынья.
// Splat — разовый рендер мягкого штампа в точку эпицентра (не на кадр). Кратеры сливаются
// MAX-блендингом (наложения дают самую глубокую воронку, а не суммарную дыру).
import type * as THREE from 'three/webgpu';
import { uniform, vec4, uv, length, sub, vec2, smoothstep, float, clamp } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { dirToLonLat } from '../sim/geo';
import { DAMAGE_TEX_W, DAMAGE_TEX_H } from '../assets/config';

const ANG_BY_YIELD: Record<number, number> = { 1: 0.03, 10: 0.05, 100: 0.09 };

export class DamageField {
  private readonly rt: THREE.RenderTarget;
  private readonly stampScene: THREE.Scene;
  private readonly stampCam: THREE.OrthographicCamera;
  private readonly stampMesh: THREE.Mesh;
  private readonly uCenter: ReturnType<typeof uniform<THREE.Vector2>>;
  private readonly uRadius: ReturnType<typeof uniform<number>>;
  private readonly uKind: ReturnType<typeof uniform<number>>; // 0=land, 1=ice

  constructor(private readonly ctx: ThreeCtx) {
    const { THREE } = ctx;
    this.rt = new THREE.RenderTarget(DAMAGE_TEX_W, DAMAGE_TEX_H, {
      depthBuffer: false,
      type: THREE.UnsignedByteType,
    });
    this.rt.texture.wrapS = THREE.RepeatWrapping; // корректный wrap по шву долготы
    this.stampScene = new THREE.Scene();
    this.stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 1); // UV-пространство [0..1]

    this.uCenter = uniform(new THREE.Vector2(0.5, 0.5));
    this.uRadius = uniform(0.05);
    this.uKind = uniform(0);

    // Профиль штампа: чаша глубины по расстоянию до центра (в UV, с поправкой на аспект 2:1).
    const d = length(sub(uv(), this.uCenter).mul(vec2(2, 1)));
    const bowl = smoothstep(this.uRadius, float(0), d); // 1 в центре → 0 на краю
    const depth = clamp(bowl, 0, 1);
    const char = clamp(bowl.mul(0.8), 0, 1);
    const melt = clamp(bowl.mul(this.uKind), 0, 1); // только лёд
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec4(depth, char, melt, 1);
    mat.transparent = false;
    // MAX-блендинг по всем каналам: наложения берут максимум (глубже/чернее/растопленнее).
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.MaxEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;

    this.stampMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.stampMesh.position.set(0.5, 0.5, 0);
    this.stampScene.add(this.stampMesh);
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  // Впечатывает воронку в поле. kind='ice' поднимает канал оплавления (полынья).
  splat(dir: Vec3, yieldMt: number, kind: 'land' | 'ice'): void {
    const { lon, lat } = dirToLonLat(dir);
    this.uCenter.value.set((lon + Math.PI) / (2 * Math.PI), (Math.PI / 2 - lat) / Math.PI);
    this.uRadius.value = ANG_BY_YIELD[yieldMt] ?? 0.05;
    this.uKind.value = kind === 'ice' ? 1 : 0;
    const prev = this.ctx.renderer.getRenderTarget();
    this.ctx.renderer.setRenderTarget(this.rt);
    this.ctx.renderer.render(this.stampScene, this.stampCam);
    this.ctx.renderer.setRenderTarget(prev);
  }

  // Полная очистка поля (planetReset).
  clear(): void {
    const prev = this.ctx.renderer.getRenderTarget();
    this.ctx.renderer.setRenderTarget(this.rt);
    this.ctx.renderer.clearColor();
    this.ctx.renderer.setRenderTarget(prev);
  }
}
```

> **Риск/фолбэк:** если `CustomBlending`+`MaxEquation` в RT ведёт себя иначе на одном из бэкендов
> или splat по шву даёт разрыв — перейти на ping-pong (два RT: читаем прошлое поле в шейдере штампа,
> пишем `max(old, new)` в новый, свопаем). Точные имена TSL-узлов (`uv`, `length`, `smoothstep`)
> сверить с three 0.185 при первой компиляции; при расхождении заменить эквивалентами.

- [ ] **Step 2: Проверка сборки**

Run: `npm run build && npm run lint`
Expected: без ошибок TS/линта.

- [ ] **Step 3: Коммит**

```bash
git add src/render/DamageField.ts src/assets/config.ts
git commit -m "feat(render): DamageField — накопительное equirect-поле урона со splat"
```

---

### Task 8: Вершинная деформация и перекраска глобуса

Глобус читает поле урона: вершинный шейдер вдавливает поверхность, фрагментный чернит/оплавляет.

**Files:**
- Modify: `src/render/GlobeView.ts` (плотная сетка + материал с displacement; принять `DamageField.texture`)
- Modify: `src/assets/config.ts` (уже добавлены `GLOBE_LON_SEG/LAT_SEG`, `MAX_CRATER_DEPTH`)

**Interfaces:**
- Consumes: `DamageField.texture` (Task 7), `GLOBE_LON_SEG/LAT_SEG`, `MAX_CRATER_DEPTH`
- Produces: `GlobeView` строит `earthMesh` из плотной сферы и материала, смещающего позицию по полю.

- [ ] **Step 1: Плотная сетка**

В `src/render/GlobeView.ts` заменить `new THREE.SphereGeometry(1, 96, 64)` на
`new THREE.SphereGeometry(1, GLOBE_LON_SEG, GLOBE_LAT_SEG)` (импорт констант из config).

- [ ] **Step 2: Материал с displacement + перекраской**

Передать `DamageField.texture` в `GlobeView` (новый параметр конструктора `damageTex: THREE.Texture`)
и собрать материал глобуса на TSL-узлах: базовый биом-`map` модулируется полем урона, позиция
смещается вдоль нормали.

```ts
// В конструкторе GlobeView, вместо MeshPhongNodeMaterial с map:
import {
  texture, uv, positionLocal, normalLocal, mix, vec3, float, clamp,
} from 'three/tsl';
import { MAX_CRATER_DEPTH } from '../assets/config';

const dmg = texture(damageTex, uv()); // R=глубина, G=гарь, B=оплавление
const depth = dmg.r;
// Вдавливание: сдвиг вершины внутрь вдоль нормали на depth*MAX_CRATER_DEPTH.
earthMaterial.positionNode = positionLocal.sub(normalLocal.mul(depth.mul(float(MAX_CRATER_DEPTH))));
// Перекраска: биом → к копоти по G, к оплавлению/полынье по B.
const base = texture(biomeMapTexture, uv()).rgb;
const charred = mix(base, vec3(0.06, 0.05, 0.05), clamp(dmg.g, 0, 1));
const molten = mix(charred, vec3(0.05, 0.12, 0.2), clamp(dmg.b, 0, 1)); // полынья — тёмная вода
earthMaterial.colorNode = molten;
```

Примечания реализации:
- `biomeMapTexture` — та же `CanvasTexture` из Task 6 (передать/сохранить как поле, чтобы
  ссылаться в `colorNode`).
- Оставить `MeshPhongNodeMaterial` (сохранить статический «солнечный» свет), задав
  `positionNode`/`colorNode`; либо `MeshLambertNodeMaterial` для дешевизны — на выбор, без
  динамического света.
- В `main.ts`/там, где создаётся `GlobeView`, порядок: сперва `DamageField` (нужен `ctx`), затем
  `GlobeView(ctx, damageField.texture)`. Обновить конструктор и вызов (см. Task 9 wiring).

- [ ] **Step 3: Проверка сборки**

Run: `npm run build && npm run lint`
Expected: без ошибок. Если TSL-узел `positionNode` не смещает (сетка плоская) — проверить, что
используется `positionLocal`/`normalLocal` (локальные), а не world-версии.

- [ ] **Step 4: Визуальная проверка**

Временный dev-хук: вызвать `damageField.splat(dir, 100, 'land')` в известной точке и снять скриншот
на лимбе планеты. Ожидаемо: видимая вмятина силуэта + тёмное обугленное пятно; два близких splat
сливаются в общий кратер.

- [ ] **Step 5: Коммит**

```bash
git add src/render/GlobeView.ts
git commit -m "feat(render): вершинная деформация глобуса по полю урона + перекраска (гарь/полынья)"
```

---

### Task 9: Маршрутизация взрыва по материалу; splat вместо декали-кратера

**Files:**
- Modify: `src/render/Scene.ts` (владеть `DamageField`, маршрутизировать по `surface`, слать splat)
- Modify: `src/render/DecalView.ts` (убрать постоянный кратер, оставить только горячую кайму)
- Modify: `src/main.ts` (создать `DamageField`, прокинуть в `GlobeView` и `Scene`)

**Interfaces:**
- Consumes: событие `explosionStarted` с `surface`/`biome` (Task 4), `DamageField` (Task 7),
  `WaterBurstView` (Task 10 — на этом шаге ещё нет; для суши/льда достаточно)
- Produces: `Scene.handleEvent` вызывает `damageField.splat` на land/ice; `planetReset` → `damageField.clear()`

- [ ] **Step 1: Убрать постоянный кратер из `DecalView`**

В `src/render/DecalView.ts` удалить `craterMesh`/`craterMaterials`/`makeCraterTexture` и связанные
поля; оставить только горячую кайму (`glowMesh`/`glowMaterial`/остывание в `update`). `spawn`
оставляет только заведение каймы. (Либо переименовать файл в `HeatGlowView.ts` — по вкусу, тогда
обновить импорт в `Scene`.)

- [ ] **Step 2: Провод в `main.ts`**

В `src/main.ts`: создать `const damageField = new DamageField(renderer.ctx);` до `GlobeView`;
передать `damageField.texture` в `new GlobeView(renderer.ctx, damageField.texture)`; передать
`damageField` в `new Scene(renderer.ctx, globe, host, rig, damageField)`.

- [ ] **Step 3: Маршрутизация в `Scene`**

`src/render/Scene.ts`: добавить поле `damageField` (параметр конструктора), расширить
`startExplosion`/`handleEvent`:

```ts
case 'explosionStarted':
  this.missileView.despawn(event.id);
  this.startExplosion(event.dir, event.yield, event.seed, event.surface, event.biome);
  break;
case 'planetReset':
  this.decalView.clear();
  this.damageField.clear();
  break;
```

```ts
startExplosion(dir: Vec3, yieldMt: number, seed: number, surface: Surface, biome: Biome): void {
  this.triggerShake(yieldMt);
  if (surface === 'water') {
    this.waterBurstView.spawn(dir, yieldMt, seed); // Task 10
  } else {
    this.explosionView.spawn(dir, yieldMt, seed);
    this.particlePool.emit(dir, yieldMt, seed, this.clock, biome); // biome — тон пыли (Task 10 доп.)
    this.decalView.spawn(dir, yieldMt, seed);
    this.damageField.splat(dir, yieldMt, surface === 'ice' ? 'ice' : 'land');
  }
  playBoom(yieldMt);
}
```

На этом шаге `waterBurstView`/biome-параметр частиц ещё не существуют — временно ветку water
свести к `this.explosionView.spawn(...)` (заглушка), а `particlePool.emit` оставить прежней
сигнатуры; полноценно — в Task 10. Импортировать типы `Surface`/`Biome` из `../sim/material`.

- [ ] **Step 4: Сборка/линт/тесты**

Run: `npm run build && npm run lint && npm test`
Expected: всё зелёное.

- [ ] **Step 5: Визуальная проверка**

Скриншоты: удар по суше → вмятина+обугливание копится в поле (постоянный след — деформация, не
декаль); «Восстановить планету» → поле очищено, планета целая.

- [ ] **Step 6: Коммит**

```bash
git add src/render/Scene.ts src/render/DecalView.ts src/main.ts
git commit -m "feat(render): маршрутизация взрыва по surface; кратер = поле урона, не декаль"
```

---

## Фаза D — Вода и лёд

### Task 10: Подводный взрыв `WaterBurstView` + тон пыли по биому

**Files:**
- Create: `src/render/WaterBurstView.ts`
- Modify: `src/render/Scene.ts` (подключить `waterBurstView`)
- Modify: `src/render/effects/particles.ts` (опц.: параметр тона пыли по биому)

**Interfaces:**
- Consumes: `ThreeCtx`, `Vec3`, пул-паттерн из `ExplosionView`
- Produces: класс `WaterBurstView` с `spawn(dir, yieldMt, seed)` и `update(dt)`

- [ ] **Step 1: Реализовать `WaterBurstView`**

Пул слотов (как `ExplosionView`, `POOL_SIZE=8`). На `spawn` активируем в точке `dir`:
- **купол брызг** — расширяющаяся белая полусфера (пере-использовать геометрию купола из
  `ExplosionView.makeShockwaveGeometry`), быстро всплывает и гаснет;
- **столб** — вытянутый вдоль нормали белый цилиндр/конус, растёт вверх и оседает;
- **пенное кольцо** — расширяющаяся плоская кайма по поверхности (patch-геометрия, как glow),
  прозрачность падает;
- **пар** — короткое облачко (доп. эмиссия `particlePool` с белым тоном, опц.).

Всё на `MeshBasicNodeMaterial` (additive/transparent), таймлайн через юниформы, без аллокаций на
кадр и без динамического света. Слот схлопывается в 0 по завершении. **В поле урона не пишем** —
следа нет.

```ts
// Подводный ядерный взрыв: купол брызг + вертикальный столб воды + пенное кольцо + пар.
// Пул слотов, таймлайн через юниформы, без динамического света. В DamageField НЕ пишет —
// вода смыкается, постоянного следа нет.
import type * as THREE from 'three/webgpu';
import { uniform, float, clamp, pow, dot, normalView, positionViewDirection } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { findFreeSlotIndex } from './SlotPool';
// ... (структура слота: dome/column/ring меши + юниформы op/scale; POOL_SIZE=8)
export class WaterBurstView {
  // constructor(ctx, parent): строит POOL_SIZE слотов из общих геометрий (dome, column, ring)
  // spawn(dir, yieldMt, seed): ориентирует по нормали, включает op/scale=старт
  // update(dt): гонит таймлайн (купол вспухает и гаснет; столб растёт и оседает; кольцо ширится)
}
```

(Полная реализация — по образцу `ExplosionView.ts`: геометрии строятся раз в конструкторе,
`spawn` только активирует слот и задаёт `quaternion`/позицию, `update` двигает юниформы. Тайминги:
столб живёт ~2.5·ts, кольцо ~4·ts, купол ~1.5·ts.)

- [ ] **Step 2: Подключить в `Scene`**

В `Scene`: `this.waterBurstView = new WaterBurstView(ctx, globe.spinGroup);` в конструкторе;
в `update` — `this.waterBurstView.update(dt);`; в `startExplosion` ветка `water` вызывает
`this.waterBurstView.spawn(dir, yieldMt, seed)` (заменить заглушку из Task 9).

- [ ] **Step 3: Тон пыли по биому (опц.)**

Если делаем: `ParticlePool.emit(dir, yieldMt, seed, clock, biome?)` — по биому выбрать цвет пыли
(песок/гарь/снег) через существующий цветовой юниформ. Иначе оставить прежнюю сигнатуру и убрать
`biome`-аргумент из вызова в `Scene`.

- [ ] **Step 4: Сборка/линт/тесты**

Run: `npm run build && npm run lint && npm test`
Expected: зелёное.

- [ ] **Step 5: Визуальная проверка**

Удар по океану → белый столб + пенное кольцо + пар, каверна смыкается, **постоянного кратера нет**;
удар по суше по-прежнему даёт гриб+вмятину.

- [ ] **Step 6: Коммит**

```bash
git add src/render/WaterBurstView.ts src/render/Scene.ts src/render/effects/particles.ts
git commit -m "feat(render): подводный ядерный взрыв (столб/купол/кольцо/пар), без следа"
```

---

### Task 11: Лёд — полынья

**Files:**
- Modify: `src/render/GlobeView.ts` (colorNode: канал B → открытая вода с каймой льда) — если не
  покрыто Task 8
- Modify: `src/render/Scene.ts` (ветка `ice`: splat kind='ice' уже из Task 9)

**Interfaces:**
- Consumes: канал `B` поля урона (Task 7 splat kind='ice'), colorNode (Task 8)

- [ ] **Step 1: Полынья в colorNode**

Убедиться, что в `GlobeView.colorNode` (Task 8) канал `B` даёт тёмную открытую воду в центре и
кайму битого льда по краю (мягкий переход `smoothstep` по `dmg.b`). При необходимости добавить
второй тон (светлая крошка льда на кромке).

- [ ] **Step 2: Проверка**

Удар по льду (Антарктида/Гренландия) → воронка + тёмная полынья в центре. Флаг `ICE_MELT` в
config (если решим отключать) — иначе лёд ведёт себя как суша.

Run: `npm run build && npm run lint`
Expected: зелёное; скриншот полыньи корректен.

- [ ] **Step 3: Коммит**

```bash
git add src/render/GlobeView.ts src/render/Scene.ts src/assets/config.ts
git commit -m "feat(render): попадание по льду — протаявшая полынья"
```

---

## Фаза E — Приёмка

### Task 12: Headless-приёмка, стресс-тест, банк памяти

**Files:**
- Modify: `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/systemPatterns.md`

- [ ] **Step 1: Полный прогон проверок**

Run: `npm test && npm run lint && npm run build`
Expected: всё зелёное.

- [ ] **Step 2: Headless-скриншоты (оба бэкенда)**

По методу проекта (Task 10 отчёт): снять биом-глобус, деформацию кратера на лимбе, слияние двух
воронок, водный столб, полынью во льду, сброс планеты. Проверить консоль на обоих бэкендах
(обычный Chrome → WebGPU, headless swiftshader → WebGL2) — без ошибок.

- [ ] **Step 3: Стресс-тест**

15 ударов подряд (смесь суша/вода) — среднее время кадра **< 20 мс**, без подвисаний (правило
проекта). Зафиксировать цифру.

- [ ] **Step 4: Обновить банк памяти**

- `activeContext.md`: текущий фокус — фича материала/разрушаемости завершена; согласованные решения.
- `progress.md`: что добавлено (материал в sim, биом-глобус, поле урона + деформация, подводный
  взрыв, полынья), статус.
- `systemPatterns.md`: новый паттерн — «поле урона» (equirect RT + splat + вершинный displacement),
  материал как авторитетный факт sim.

- [ ] **Step 5: Финальный коммит**

```bash
git add memory-bank/
git commit -m "docs(memory-bank): материал поверхности и разрушаемость — итоги этапа"
```

- [ ] **Step 6: Завершение ветки**

Использовать `superpowers:finishing-a-development-branch` для мёржа/PR ветки
`feat/material-destructibility`.

---

## Self-review (покрытие спеки)

- §4 Материал в sim → Tasks 1–4 ✅
- §5 Стилизованный глобус → Tasks 5–6 ✅
- §6 Разрушаемость (поле + displacement) → Tasks 7–9 ✅
- §7 Взрывы по материалу (вода/суша/лёд) → Tasks 9–11 ✅
- §9 Перф (плотная сетка/поле/splat, без дин. света) → Tasks 6–9, 12 ✅
- §10 Тестирование (sim-юниты + headless-скриншоты + стресс) → Tasks 1–5, 12 ✅
- §11 Риски (ассет landmask, splat-искажение, max-блендинг) → отмечены в Tasks 2, 7 ✅
