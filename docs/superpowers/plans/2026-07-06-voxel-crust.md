# Воксельная кора планеты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удары реально выгрызают куски коры (Surface Nets воксельные чанки поверх гладкого глобуса), повторные удары копают глубже — до светящейся магмы.

**Architecture:** Чистый TS-модуль `src/crust/` хранит воксельную оболочку (cube-sphere 6×256×256×8, ленивые чанки 32×32×8) и `carve()`. Рендер-гибрид: нетронутая планета — текущая сфера; повреждённый чанк ремешится Surface Nets и рисуется поверх, глобус в этом регионе discard'ится по equirect-маске дырок. Под корой — эмиссивная магма-сфера.

**Tech Stack:** three 0.185 WebGPURenderer (+WebGL2-фолбэк), TSL-узловые материалы, Vite, TypeScript strict, vitest.

**Спека:** `docs/superpowers/specs/2026-07-06-voxel-crust-design.md`

## Global Constraints

- Комментарии в коде и коммиты — на русском (тех. термины не переводим).
- Все шейдеры — TSL-узлы, никакого сырого GLSL/WGSL; никакого динамического света.
- Оба бэкенда: WebGPU и WebGL2 (swiftshader headless). Никаких RT-трюков в новых материалах — только обычные BufferGeometry.
- Слои: `sim` не импортирует `render`/`crust`; `crust` может импортировать `sim` (чистый TS, без three); `render` может импортировать `crust`.
- Grep-провекра перед коммитом: `npm test && npm run lint && npm run build` зелёные.
- Данные RT-текстур: помнить про V-flip сэмплинга RT и кламп ≥0 вывода node-материалов (см. `bugs.md`, memory `three-node-material-rt-pitfalls`) — в этом плане RT не пишем, только читаем существующие (biome/damage) в конвенции сферы, как GlobeView.

---

### Task 1: Этап-0 — уменьшить радиусы кратеров текущего поля

Пользовательский фикс, не зависит от вокселей: кратеры/гарь слишком большие.

**Files:**
- Modify: `src/render/DamageField.ts` (константа `ANG_BY_YIELD`, ~строка 48)

**Interfaces:**
- Produces: новые радиусы поля урона; позже (Task 10) они же — только гарь/полынья.

- [ ] **Step 1: Уменьшить радиусы вдвое**

В `src/render/DamageField.ts` заменить:

```ts
const ANG_BY_YIELD: Record<number, number> = { 1: 0.03, 10: 0.05, 100: 0.09 };
```

на:

```ts
// Радиусы поля урона по мощности (доля equirect-UV). Уменьшены ~вдвое по фидбэку
// пользователя («кратеры слишком большие»): гарь 100Мт больше не накрывает пол-материка.
const ANG_BY_YIELD: Record<number, number> = { 1: 0.015, 10: 0.025, 100: 0.045 };
```

- [ ] **Step 2: Проверить и закоммитить**

Run: `npm test && npm run lint && npm run build`
Expected: 67 passed, lint чисто, build без ошибок.

```bash
git add src/render/DamageField.ts
git commit -m "fix(render): радиусы поля урона ~вдвое меньше — кратеры/гарь были избыточно большими"
```

---

### Task 2: `crust/cubesphere.ts` — cube-sphere проекции + константы коры

**Files:**
- Create: `src/crust/cubesphere.ts`
- Modify: `src/assets/config.ts` (добавить константы коры в конец файла)
- Test: `test/crust/cubesphere.test.ts`

**Interfaces:**
- Consumes: `Vec3` из `src/sim/geo.ts`.
- Produces:
  - `type FaceId = 0|1|2|3|4|5`
  - `faceUVToDir(face: FaceId, u: number, v: number): Vec3` — u,v ∈ [0,1] (допустимо и вне: экстраполяция за грань для margin-сэмплов)
  - `dirToFaceUV(dir: Vec3): { face: FaceId; u: number; v: number }`
  - config: `CRUST_FACE_N=256`, `CRUST_DEPTH_LAYERS=8`, `CRUST_CHUNK=32`, `CRUST_VOX_ANG=(Math.PI/2)/CRUST_FACE_N`, `CRUST_VOX_H=CRUST_VOX_ANG`, `MAGMA_R=0.945`

- [ ] **Step 1: Написать падающий тест**

`test/crust/cubesphere.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { faceUVToDir, dirToFaceUV, type FaceId } from '../../src/crust/cubesphere';

describe('cubesphere', () => {
  it('roundtrip dir → faceUV → dir для сетки направлений', () => {
    for (let i = 0; i < 200; i++) {
      // детерминированная сетка направлений (без Math.random — воспроизводимость)
      const t = i / 200;
      const lon = t * Math.PI * 2 - Math.PI;
      const lat = Math.sin(i * 12.9898) * 1.4; // псевдослучайные широты в (−1.4..1.4) рад
      const d = {
        x: Math.cos(lat) * Math.cos(lon),
        y: Math.sin(lat),
        z: -Math.cos(lat) * Math.sin(lon),
      };
      const { face, u, v } = dirToFaceUV(d);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const back = faceUVToDir(face, u, v);
      expect(back.x).toBeCloseTo(d.x, 6);
      expect(back.y).toBeCloseTo(d.y, 6);
      expect(back.z).toBeCloseTo(d.z, 6);
    }
  });

  it('центры граней смотрят вдоль осей', () => {
    expect(faceUVToDir(0, 0.5, 0.5).x).toBeCloseTo(1, 9); // +X
    expect(faceUVToDir(2, 0.5, 0.5).y).toBeCloseTo(1, 9); // +Y (север)
    expect(faceUVToDir(5, 0.5, 0.5).z).toBeCloseTo(-1, 9); // −Z
  });

  it('экстраполяция за грань (u<0) даёт единичный вектор', () => {
    const d = faceUVToDir(0 as FaceId, -0.01, 0.5);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run test/crust/cubesphere.test.ts`
Expected: FAIL — модуль `src/crust/cubesphere` не существует.

- [ ] **Step 3: Реализация**

`src/crust/cubesphere.ts`:

```ts
// Cube-sphere проекция для воксельной коры: 6 граней куба, каждая грань — сетка N×N столбцов.
// u,v ∈ [0,1] на грани; допускается лёгкая экстраполяция за [0,1] (margin-сэмплы мешера у края
// грани) — точка на плоскости куба нормализуется в любой случай. Слой d — глубина: воксель
// (x,y,d) имеет центр на радиусе r = 1 − (d+0.5)·CRUST_VOX_H (d=0 — поверхность).
import type { Vec3 } from '../sim/geo';

export type FaceId = 0 | 1 | 2 | 3 | 4 | 5; // +X −X +Y −Y +Z −Z

export function faceUVToDir(face: FaceId, u: number, v: number): Vec3 {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  let p: Vec3;
  switch (face) {
    case 0:
      p = { x: 1, y: b, z: -a };
      break;
    case 1:
      p = { x: -1, y: b, z: a };
      break;
    case 2:
      p = { x: a, y: 1, z: -b };
      break;
    case 3:
      p = { x: a, y: -1, z: b };
      break;
    case 4:
      p = { x: a, y: b, z: 1 };
      break;
    default:
      p = { x: -a, y: b, z: -1 };
      break;
  }
  const len = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

export function dirToFaceUV(dir: Vec3): { face: FaceId; u: number; v: number } {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  let face: FaceId;
  let a: number;
  let b: number;
  if (ax >= ay && ax >= az) {
    face = dir.x > 0 ? 0 : 1;
    b = dir.y / ax;
    a = dir.x > 0 ? -dir.z / ax : dir.z / ax;
  } else if (ay >= az) {
    face = dir.y > 0 ? 2 : 3;
    a = dir.x / ay;
    b = dir.y > 0 ? -dir.z / ay : dir.z / ay;
  } else {
    face = dir.z > 0 ? 4 : 5;
    b = dir.y / az;
    a = dir.z > 0 ? dir.x / az : -dir.x / az;
  }
  return { face, u: (a + 1) / 2, v: (b + 1) / 2 };
}
```

В конец `src/assets/config.ts` добавить:

```ts
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
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run test/crust/cubesphere.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add src/crust/cubesphere.ts src/assets/config.ts test/crust/cubesphere.test.ts
git commit -m "feat(crust): cube-sphere проекции граней + константы воксельной коры"
```

---

### Task 3: `crust/Crust.ts` — состояние коры (ленивые чанки, материалы)

**Files:**
- Create: `src/crust/Crust.ts`
- Test: `test/crust/Crust.test.ts`

**Interfaces:**
- Consumes: `faceUVToDir`, `dirToFaceUV`, `FaceId` (Task 2); `materialAtDir` из `src/sim/material.ts`; config-константы коры.
- Produces:
  - `MAT_EMPTY=0, MAT_SOIL=1, MAT_ROCK=2, MAT_BASALT=3, MAT_WATER=4`
  - `pristineMaterial(d: number): number`
  - `class Crust`:
    - `getVoxel(face: FaceId, x: number, y: number, d: number): number` — за пределами сетки/глубины → `MAT_EMPTY`
    - `getVoxelExt(face: FaceId, x: number, y: number, d: number): number` — как getVoxel, но x/y за краем грани перепроецируются на соседнюю грань (для margin мешера)
    - `chunkKey(face: FaceId, cx: number, cy: number): string` (`'f:cx:cy'`)
    - `reset(): void`
    - `removedVoxels: number` (readonly счётчик)

- [ ] **Step 1: Падающий тест**

`test/crust/Crust.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Crust, MAT_EMPTY, MAT_SOIL, MAT_ROCK, MAT_BASALT, MAT_WATER } from '../../src/crust/Crust';
import { dirToFaceUV } from '../../src/crust/cubesphere';
import { lonLatToDir } from '../../src/sim/geo';
import { CRUST_FACE_N, CRUST_DEPTH_LAYERS } from '../../src/assets/config';

const deg = (x: number) => (x * Math.PI) / 180;

// столбец (face,x,y) по lon/lat
function columnOf(lonDeg: number, latDeg: number) {
  const { face, u, v } = dirToFaceUV(lonLatToDir(deg(lonDeg), deg(latDeg)));
  return {
    face,
    x: Math.min(CRUST_FACE_N - 1, Math.floor(u * CRUST_FACE_N)),
    y: Math.min(CRUST_FACE_N - 1, Math.floor(v * CRUST_FACE_N)),
  };
}

describe('Crust: нетронутое состояние', () => {
  it('суша (Сахара): грунт сверху, порода в середине, базальт внизу', () => {
    const crust = new Crust();
    const { face, x, y } = columnOf(20, 23);
    expect(crust.getVoxel(face, x, y, 0)).toBe(MAT_SOIL);
    expect(crust.getVoxel(face, x, y, 3)).toBe(MAT_ROCK);
    expect(crust.getVoxel(face, x, y, CRUST_DEPTH_LAYERS - 1)).toBe(MAT_BASALT);
  });

  it('океан (центр Тихого): столбец — вода на всех слоях', () => {
    const crust = new Crust();
    const { face, x, y } = columnOf(-140, 0);
    expect(crust.getVoxel(face, x, y, 0)).toBe(MAT_WATER);
    expect(crust.getVoxel(face, x, y, 5)).toBe(MAT_WATER);
  });

  it('над поверхностью и под корой — пусто', () => {
    const crust = new Crust();
    const { face, x, y } = columnOf(20, 23);
    expect(crust.getVoxel(face, x, y, -1)).toBe(MAT_EMPTY);
    expect(crust.getVoxel(face, x, y, CRUST_DEPTH_LAYERS)).toBe(MAT_EMPTY);
  });

  it('getVoxelExt за краем грани перепроецируется (не пусто на суше соседней грани)', () => {
    const crust = new Crust();
    // столбец у самого края грани — сэмпл x−2 уходит на соседнюю грань, но остаётся валидным
    const { face, y } = columnOf(0, 0);
    const m = crust.getVoxelExt(face, -2, y, 0);
    expect([MAT_SOIL, MAT_ROCK, MAT_WATER]).toContain(m);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run test/crust/Crust.test.ts`
Expected: FAIL — `src/crust/Crust` не существует.

- [ ] **Step 3: Реализация**

`src/crust/Crust.ts`:

```ts
// Состояние воксельной коры. ЧИСТЫЙ TS (без three) — тестируется headless, детерминирован.
// Хранение ленивое: чанк материализуется (Uint8Array) только когда его впервые режет carve;
// нетронутые воксели вычисляются на лету из landmask/биома (pristineVoxel) — память ~0 до ударов.
// Каналы значений — материал-id (MAT_*). Вода (океанские столбцы) НЕ карвится и мешится как
// «морское дно» (иначе у берега глобус-дырка показала бы магму под океаном).
import type { Vec3 } from '../sim/geo';
import { materialAtDir } from '../sim/material';
import { faceUVToDir, dirToFaceUV, type FaceId } from './cubesphere';
import { CRUST_FACE_N, CRUST_DEPTH_LAYERS, CRUST_CHUNK } from '../assets/config';

export const MAT_EMPTY = 0;
export const MAT_SOIL = 1;
export const MAT_ROCK = 2;
export const MAT_BASALT = 3;
export const MAT_WATER = 4;

const N = CRUST_FACE_N;
const D = CRUST_DEPTH_LAYERS;
const CH = CRUST_CHUNK;

// Материал нетронутой суши по глубине: грунт (0-1) → порода (2-4) → базальт (5+).
export function pristineMaterial(d: number): number {
  return d <= 1 ? MAT_SOIL : d <= 4 ? MAT_ROCK : MAT_BASALT;
}

export class Crust {
  // Материализованные чанки: ключ 'face:cx:cy' → Uint8Array(CH*CH*D), индекс ((ly*CH+lx)*D+d).
  protected readonly chunks = new Map<string, Uint8Array>();
  removedVoxels = 0;

  chunkKey(face: FaceId, cx: number, cy: number): string {
    return `${face}:${cx}:${cy}`;
  }

  // Направление центра столбца (x,y) грани face.
  columnDir(face: FaceId, x: number, y: number): Vec3 {
    return faceUVToDir(face, (x + 0.5) / N, (y + 0.5) / N);
  }

  // Материал нетронутого вокселя — вычисляется на лету (ленивость хранения).
  private pristineVoxel(face: FaceId, x: number, y: number, d: number): number {
    if (materialAtDir(this.columnDir(face, x, y)).surface === 'water') return MAT_WATER;
    return pristineMaterial(d);
  }

  getVoxel(face: FaceId, x: number, y: number, d: number): number {
    if (x < 0 || y < 0 || x >= N || y >= N || d < 0 || d >= D) return MAT_EMPTY;
    const chunk = this.chunks.get(this.chunkKey(face, Math.floor(x / CH), Math.floor(y / CH)));
    if (chunk) return chunk[((y % CH) * CH + (x % CH)) * D + d] ?? MAT_EMPTY;
    return this.pristineVoxel(face, x, y, d);
  }

  // Как getVoxel, но x/y за краем грани перепроецируются через направление на соседнюю грань
  // (margin-сэмплы мешера у рёбер куба). d за пределами глубины — по-прежнему пусто.
  getVoxelExt(face: FaceId, x: number, y: number, d: number): number {
    if (d < 0 || d >= D) return MAT_EMPTY;
    if (x >= 0 && y >= 0 && x < N && y < N) return this.getVoxel(face, x, y, d);
    const dir = faceUVToDir(face, (x + 0.5) / N, (y + 0.5) / N);
    const p = dirToFaceUV(dir);
    const nx = Math.min(N - 1, Math.max(0, Math.floor(p.u * N)));
    const ny = Math.min(N - 1, Math.max(0, Math.floor(p.v * N)));
    return this.getVoxel(p.face, nx, ny, d);
  }

  // Материализует чанк (копирует pristine-состояние в Uint8Array) — вызывается перед записью.
  protected ensureChunk(face: FaceId, cx: number, cy: number): Uint8Array {
    const key = this.chunkKey(face, cx, cy);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    chunk = new Uint8Array(CH * CH * D);
    for (let ly = 0; ly < CH; ly++)
      for (let lx = 0; lx < CH; lx++) {
        const water =
          materialAtDir(this.columnDir(face, cx * CH + lx, cy * CH + ly)).surface === 'water';
        for (let d = 0; d < D; d++)
          chunk[(ly * CH + lx) * D + d] = water ? MAT_WATER : pristineMaterial(d);
      }
    this.chunks.set(key, chunk);
    return chunk;
  }

  reset(): void {
    this.chunks.clear();
    this.removedVoxels = 0;
  }
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run test/crust/Crust.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add src/crust/Crust.ts test/crust/Crust.test.ts
git commit -m "feat(crust): состояние воксельной коры — ленивые чанки, материалы по глубине, вода"
```

---

### Task 4: `Crust.carve()` — выгрызание эллипсоида + накопление

**Files:**
- Modify: `src/crust/Crust.ts`
- Test: `test/crust/carve.test.ts`

**Interfaces:**
- Consumes: класс `Crust` (Task 3), `dot` из `src/sim/geo.ts`.
- Produces:
  - `interface CarveResult { changed: string[]; removed: number }`
  - `Crust.carve(dir: Vec3, radiusRad: number, depthVox: number, seed: number): CarveResult` —
    `changed` содержит ключи задетых чанков ПЛЮС их боковых соседей (мешер обеих сторон границы
    должен переремешиться).

- [ ] **Step 1: Падающий тест**

`test/crust/carve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Crust, MAT_EMPTY, MAT_WATER } from '../../src/crust/Crust';
import { lonLatToDir } from '../../src/sim/geo';

const deg = (x: number) => (x * Math.PI) / 180;
const SAHARA = lonLatToDir(deg(20), deg(23));
const PACIFIC = lonLatToDir(deg(-140), 0);

describe('Crust.carve', () => {
  it('удар по суше выбивает воксели и возвращает задетые чанки', () => {
    const crust = new Crust();
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    expect(res.removed).toBeGreaterThan(50);
    expect(res.changed.length).toBeGreaterThan(0);
    expect(crust.removedVoxels).toBe(res.removed);
  });

  it('детерминизм: одинаковые аргументы → одинаковый результат', () => {
    const a = new Crust().carve(SAHARA, 0.046, 5, 42);
    const b = new Crust().carve(SAHARA, 0.046, 5, 42);
    expect(a.removed).toBe(b.removed);
    expect(a.changed).toEqual(b.changed);
  });

  it('повторный удар в ту же точку копает глубже (кумулятивно)', () => {
    const crust = new Crust();
    const r1 = crust.carve(SAHARA, 0.046, 5, 1);
    const r2 = crust.carve(SAHARA, 0.046, 5, 2);
    expect(r2.removed).toBeGreaterThan(0); // второй удар тоже выбивает (углубляет)
    expect(crust.removedVoxels).toBe(r1.removed + r2.removed);
  });

  it('океан не карвится', () => {
    const crust = new Crust();
    const res = crust.carve(PACIFIC, 0.046, 5, 42);
    expect(res.removed).toBe(0);
  });

  it('выбитые воксели действительно пустые (в центре удара)', () => {
    const crust = new Crust();
    crust.carve(SAHARA, 0.046, 5, 42);
    // после удара по центру: верхний воксель столбца эпицентра пуст
    const { dirToFaceUV } = require('../../src/crust/cubesphere');
    const { CRUST_FACE_N } = require('../../src/assets/config');
    const { face, u, v } = dirToFaceUV(SAHARA);
    const x = Math.floor(u * CRUST_FACE_N);
    const y = Math.floor(v * CRUST_FACE_N);
    const top = crust.getVoxel(face, x, y, 0);
    expect([MAT_EMPTY, MAT_WATER]).toContain(top);
    expect(top).toBe(MAT_EMPTY);
  });
});
```

(Примечание: `require` в последнем тесте заменить на обычные импорты сверху файла —
`dirToFaceUV` из `../../src/crust/cubesphere`, `CRUST_FACE_N` из `../../src/assets/config`.)

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run test/crust/carve.test.ts`
Expected: FAIL — `carve` не существует.

- [ ] **Step 3: Реализация**

В `src/crust/Crust.ts` добавить импорты `dot` из `../sim/geo` и `CRUST_VOX_H, CRUST_VOX_ANG`
из `../assets/config`, экспортируемый тип и метод:

```ts
export interface CarveResult {
  changed: string[]; // ключи чанков на ремеш (задетые + боковые соседи)
  removed: number; // сколько вокселей выбито этим ударом
}
```

```ts
  // Детерминированный хеш → [0,1): рваные края carve-эллипсоида без Math.random.
  private static jitter(face: number, x: number, y: number, seed: number): number {
    let h = (face * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ (seed * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Выгрызает эллипсоид: боковая полуось radiusRad (рад), радиальная — depthVox слоёв.
  // Центр — на ТЕКУЩЕЙ поверхности столбца эпицентра (первый непустой воксель) → повторные
  // удары в ту же точку копают глубже. Вода не карвится. Возвращает чанки на ремеш.
  carve(dir: Vec3, radiusRad: number, depthVox: number, seed: number): CarveResult {
    // 1) текущая поверхность в эпицентре
    const c = dirToFaceUV(dir);
    const ex = Math.min(N - 1, Math.floor(c.u * N));
    const ey = Math.min(N - 1, Math.floor(c.v * N));
    let surfD = 0;
    while (surfD < D && this.getVoxel(c.face, ex, ey, surfD) === MAT_EMPTY) surfD++;
    const centerR = 1 - (surfD + 0.5) * CRUST_VOX_H;

    const changed = new Set<string>();
    let removed = 0;
    const latR = Math.max(radiusRad, CRUST_VOX_ANG * 0.75); // не уже одного вокселя
    const radR = Math.max(depthVox, 1) * CRUST_VOX_H;
    // столбцы дальше angLim гарантированно вне эллипсоида (с запасом на джиттер)
    const cosLim = Math.cos(Math.min(latR * 1.4 + CRUST_VOX_ANG, Math.PI / 2));

    for (let face = 0 as FaceId; face < 6; face++) {
      for (let cy = 0; cy < N / CH; cy++)
        for (let cx = 0; cx < N / CH; cx++) {
          // быстрый чанк-реджект по углу до центра чанка (запас — полдиагонали чанка)
          const chunkDir = this.columnDir(face, cx * CH + CH / 2, cy * CH + CH / 2);
          const chunkHalf = CH * CRUST_VOX_ANG; // с запасом (чанк ≤ CH·voxAng по диагонали/√2·2)
          if (dot(chunkDir, dir) < Math.cos(Math.min(latR * 1.4 + chunkHalf, Math.PI))) continue;

          let chunk: Uint8Array | null = null;
          for (let ly = 0; ly < CH; ly++)
            for (let lx = 0; lx < CH; lx++) {
              const x = cx * CH + lx;
              const y = cy * CH + ly;
              const colDir = this.columnDir(face, x, y);
              const cosAng = dot(colDir, dir);
              if (cosAng < cosLim) continue;
              const ang = Math.acos(Math.min(1, cosAng));
              const t = ang / latR;
              if (t > 1.3) continue;
              const jit = 1 + (Crust.jitter(face, x, y, seed) - 0.5) * 0.3;
              for (let d = 0; d < D; d++) {
                const rv = 1 - (d + 0.5) * CRUST_VOX_H;
                const s = (rv - centerR) / radR;
                if (t * t + s * s > jit) continue;
                chunk ??= this.ensureChunk(face, cx, cy);
                const idx = (ly * CH + lx) * D + d;
                const m = chunk[idx] ?? MAT_EMPTY;
                if (m === MAT_EMPTY || m === MAT_WATER) continue;
                chunk[idx] = MAT_EMPTY;
                removed++;
              }
              if (chunk) {
                changed.add(this.chunkKey(face, cx, cy));
                // боковые соседи задетых ГРАНИЧНЫХ столбцов — тоже на ремеш (их margin изменился)
                if (lx === 0 && cx > 0) changed.add(this.chunkKey(face, cx - 1, cy));
                if (lx === CH - 1 && cx < N / CH - 1) changed.add(this.chunkKey(face, cx + 1, cy));
                if (ly === 0 && cy > 0) changed.add(this.chunkKey(face, cx, cy - 1));
                if (ly === CH - 1 && cy < N / CH - 1) changed.add(this.chunkKey(face, cx, cy + 1));
              }
            }
        }
    }
    this.removedVoxels += removed;
    return { changed: [...changed].sort(), removed };
  }
```

Замечание для реализатора: флаг `chunk` внутри цикла столбцов взводится только если в ЭТОМ
столбце что-то выбито — пометка соседей должна происходить только тогда. Если после цикла по
`d` ничего не выбито в столбце, `chunk` мог быть материализован предыдущим столбцом этого же
чанка — пометка `changed.add(chunkKey(face,cx,cy))` от этого не ломается (чанк действительно
менялся ранее), но пометку соседей обернуть условием «в этом столбце был удалён хотя бы один
воксель» (локальный счётчик `removedInColumn`).

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/crust`
Expected: PASS (все тесты crust).

- [ ] **Step 5: Commit**

```bash
git add src/crust/Crust.ts test/crust/carve.test.ts
git commit -m "feat(crust): carve — выгрызание эллипсоида с рваным краем, накопление от текущей поверхности"
```

---

### Task 5: `crust/surfaceNets.ts` — мешер (чистая функция)

**Files:**
- Create: `src/crust/surfaceNets.ts`
- Test: `test/crust/surfaceNets.test.ts`

**Interfaces:**
- Consumes: ничего проектного (чистая геометрия).
- Produces:
  - `interface NetsResult { verts: number[]; tris: number[]; vmat: number[] }` — verts: тройки
    НЕПРЕРЫВНЫХ координат решётки (lx,ly,ld могут быть дробными и −0.5); tris: индексы вершин
    (тройки); vmat: материал на вершину (id верхнего прилегающего твёрдого вокселя).
  - `surfaceNets(solidAt, matAt, nx, ny, nd, ownQuad): NetsResult`, где
    - `solidAt(x,y,d): boolean` — занятость вокселя, вызывается для x,y ∈ [−1..nx], d ∈ [−1..nd]
    - `matAt(x,y,d): number` — материал вокселя (для vmat)
    - `ownQuad(x,y): boolean` — фильтр принадлежности квада чанку по НИЖНЕЙ боковой координате
      порождающего ребра (дедуп граней между соседними чанками)

- [ ] **Step 1: Падающий тест**

`test/crust/surfaceNets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { surfaceNets } from '../../src/crust/surfaceNets';

const always = () => true;

describe('surfaceNets', () => {
  it('сплошная плита даёт замкнутую поверхность (вершины и треугольники есть)', () => {
    // плита 4×4×2 в решётке 4×4×4 (нижние 2 слоя твёрдые)
    const solid = (x: number, y: number, d: number) =>
      x >= 0 && y >= 0 && x < 4 && y < 4 && d >= 2 && d < 4;
    const r = surfaceNets(solid, () => 1, 4, 4, 4, always);
    expect(r.verts.length / 3).toBeGreaterThan(0);
    expect(r.tris.length % 3).toBe(0);
    // все индексы валидны
    const nVerts = r.verts.length / 3;
    for (const i of r.tris) expect(i).toBeLessThan(nVerts);
    expect(r.vmat.length).toBe(nVerts);
  });

  it('пустое поле → пустой меш', () => {
    const r = surfaceNets(() => false, () => 0, 4, 4, 4, always);
    expect(r.verts.length).toBe(0);
    expect(r.tris.length).toBe(0);
  });

  it('полное поле (без границ в диапазоне сэмплов) → грани только на краях диапазона', () => {
    const solid = (x: number, y: number, d: number) =>
      x >= 0 && y >= 0 && d >= 0 && x < 4 && y < 4 && d < 4;
    const r = surfaceNets(solid, () => 1, 4, 4, 4, always);
    expect(r.tris.length).toBeGreaterThan(0); // крышка+стенки+дно куба 4×4×4
  });

  it('ownQuad фильтрует квады по боковой координате ребра', () => {
    const solid = (x: number, y: number, d: number) =>
      x >= 0 && y >= 0 && d >= 0 && x < 4 && y < 4 && d < 4;
    const all = surfaceNets(solid, () => 1, 4, 4, 4, always);
    const none = surfaceNets(solid, () => 1, 4, 4, 4, () => false);
    expect(none.tris.length).toBe(0);
    expect(all.tris.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run test/crust/surfaceNets.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализация**

`src/crust/surfaceNets.ts`:

```ts
// Наивные Surface Nets по бинарному полю занятости. Сэмплы — воксели (целые узлы решётки);
// ячейка — куб из 2×2×2 соседних сэмплов. В каждой смешанной ячейке ставится одна вершина
// (среднее середин рёбер со сменой знака — «стянутый кубик», скошенные края без лего-ступенек);
// на каждом ребре решётки со сменой знака — квад из вершин 4 прилегающих ячеек.
// Диапазон сэмплов: x,y ∈ [−1..nx], d ∈ [−1..nd] — margin в один воксель со всех сторон,
// чтобы грани на границе чанка совпали с соседними чанками (те считают из тех же сэмплов).
// ownQuad(xEdge, yEdge) — дедуп между чанками: квад эмитится только «владельцем» ребра.
export interface NetsResult {
  verts: number[]; // тройки (x,y,d) в непрерывных координатах решётки
  tris: number[]; // индексы (тройки)
  vmat: number[]; // материал вершины
}

export function surfaceNets(
  solidAt: (x: number, y: number, d: number) => boolean,
  matAt: (x: number, y: number, d: number) => number,
  nx: number,
  ny: number,
  nd: number,
  ownQuad: (xEdgeLow: number, yEdgeLow: number) => boolean,
): NetsResult {
  // кэш занятости: индексы со сдвигом +1 (x ∈ [−1..nx] → [0..nx+1])
  const sx = nx + 2;
  const sy = ny + 2;
  const sd = nd + 2;
  const occ = new Uint8Array(sx * sy * sd);
  const oi = (x: number, y: number, d: number) => ((y + 1) * sx + (x + 1)) * sd + (d + 1);
  for (let y = -1; y <= ny; y++)
    for (let x = -1; x <= nx; x++)
      for (let d = -1; d <= nd; d++) occ[oi(x, y, d)] = solidAt(x, y, d) ? 1 : 0;

  // вершины: по одной на смешанную ячейку; ячейка (x,y,d) — куб сэмплов (x..x+1, y..y+1, d..d+1)
  const cellVert = new Int32Array(sx * sy * sd).fill(-1);
  const verts: number[] = [];
  const vmat: number[] = [];
  const CORNERS: Array<[number, number, number]> = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  // 12 рёбер куба как пары индексов углов
  const EDGES: Array<[number, number]> = [
    [0, 1], [2, 3], [4, 5], [6, 7], // вдоль X
    [0, 2], [1, 3], [4, 6], [5, 7], // вдоль Y
    [0, 4], [1, 5], [2, 6], [3, 7], // вдоль D
  ];
  for (let y = -1; y < ny; y++)
    for (let x = -1; x < nx; x++)
      for (let d = -1; d < nd; d++) {
        let mask = 0;
        for (let ci = 0; ci < 8; ci++) {
          const [dx, dy, dd] = CORNERS[ci]!;
          if (occ[oi(x + dx, y + dy, d + dd)]) mask |= 1 << ci;
        }
        if (mask === 0 || mask === 0xff) continue;
        // вершина = ячейкин центр масс середин рёбер со сменой знака
        let px = 0;
        let py = 0;
        let pd = 0;
        let cnt = 0;
        for (const [a, b] of EDGES) {
          const sa = (mask >> a) & 1;
          const sb = (mask >> b) & 1;
          if (sa === sb) continue;
          const [ax, ay, ad] = CORNERS[a]!;
          const [bx, by, bd] = CORNERS[b]!;
          px += (ax + bx) / 2;
          py += (ay + by) / 2;
          pd += (ad + bd) / 2;
          cnt++;
        }
        cellVert[oi(x, y, d)] = verts.length / 3;
        verts.push(x + px / cnt, y + py / cnt, d + pd / cnt);
        // материал вершины: самый «верхний» (min d) твёрдый угол ячейки
        let best = 0;
        let bestD = Infinity;
        for (let ci = 0; ci < 8; ci++) {
          if (!((mask >> ci) & 1)) continue;
          const [dx, dy, dd] = CORNERS[ci]!;
          if (d + dd < bestD) {
            bestD = d + dd;
            best = matAt(x + dx, y + dy, d + dd);
          }
        }
        vmat.push(best);
      }

  // квады: для каждого ребра решётки со сменой знака — 4 прилегающие ячейки
  const tris: number[] = [];
  const AX: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let axis = 0; axis < 3; axis++) {
    const [ux, uy, ud] = AX[axis]!;
    // две другие оси — для обхода прилегающих ячеек
    const [vx, vy, vd] = AX[(axis + 1) % 3]!;
    const [wx, wy, wd] = AX[(axis + 2) % 3]!;
    for (let y = -1; y <= ny; y++)
      for (let x = -1; x <= nx; x++)
        for (let d = -1; d <= nd; d++) {
          const x2 = x + ux;
          const y2 = y + uy;
          const d2 = d + ud;
          if (x2 > nx || y2 > ny || d2 > nd) continue;
          const s0 = occ[oi(x, y, d)]!;
          const s1 = occ[oi(x2, y2, d2)]!;
          if (s0 === s1) continue;
          if (!ownQuad(Math.min(x, x2), Math.min(y, y2))) continue;
          // 4 ячейки вокруг ребра: (p−v−w, p−v, p−w, p), p = min-угол ребра
          const c00 = cellVert[oi(x - vx - wx, y - vy - wy, d - vd - wd)]!;
          const c01 = cellVert[oi(x - vx, y - vy, d - vd)]!;
          const c10 = cellVert[oi(x - wx, y - wy, d - wd)]!;
          const c11 = cellVert[oi(x, y, d)]!;
          if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;
          if (s0) tris.push(c00, c10, c11, c00, c11, c01);
          else tris.push(c00, c01, c11, c00, c11, c10);
        }
  }
  return { verts, tris, vmat };
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run test/crust/surfaceNets.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add src/crust/surfaceNets.ts test/crust/surfaceNets.test.ts
git commit -m "feat(crust): мешер Surface Nets — бинарное поле, margin-сэмплы, дедуп квадов между чанками"
```

---

### Task 6: `crust/chunkGeometry.ts` — решётка → мировые координаты и атрибуты

Чистая (не-three) генерация массивов позиций/uv/материалов чанка. three-обёртка — в Task 7.

**Files:**
- Create: `src/crust/chunkGeometry.ts`
- Test: `test/crust/chunkGeometry.test.ts`

**Interfaces:**
- Consumes: `Crust` (getVoxelExt), `surfaceNets`, `faceUVToDir`, config.
- Produces:
  - `interface ChunkGeo { positions: Float32Array; uvs: Float32Array; mats: Float32Array; indices: Uint32Array }` (positions — xyz, uvs — equirect-uv В КОНВЕНЦИИ СФЕРЫ: v=1 — север; mats — материал-id float)
  - `buildChunkGeo(crust: Crust, face: FaceId, cx: number, cy: number): ChunkGeo | null` — null, если меш пуст

- [ ] **Step 1: Падающий тест**

`test/crust/chunkGeometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Crust } from '../../src/crust/Crust';
import { buildChunkGeo } from '../../src/crust/chunkGeometry';
import { dirToFaceUV } from '../../src/crust/cubesphere';
import { lonLatToDir } from '../../src/sim/geo';
import { CRUST_FACE_N, CRUST_CHUNK } from '../../src/assets/config';

const deg = (x: number) => (x * Math.PI) / 180;
const SAHARA = lonLatToDir(deg(20), deg(23));

describe('buildChunkGeo', () => {
  it('после carve чанк эпицентра даёт непустой меш с валидными данными', () => {
    const crust = new Crust();
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    expect(res.changed.length).toBeGreaterThan(0);
    const { face, u, v } = dirToFaceUV(SAHARA);
    const cx = Math.floor((u * CRUST_FACE_N) / CRUST_CHUNK);
    const cy = Math.floor((v * CRUST_FACE_N) / CRUST_CHUNK);
    const geo = buildChunkGeo(crust, face, cx, cy);
    expect(geo).not.toBeNull();
    const g = geo!;
    expect(g.positions.length % 3).toBe(0);
    expect(g.indices.length % 3).toBe(0);
    // радиусы вершин в разумном диапазоне: [дно коры − ε .. 1 + ε]
    for (let i = 0; i < g.positions.length; i += 3) {
      const r = Math.hypot(g.positions[i]!, g.positions[i + 1]!, g.positions[i + 2]!);
      expect(r).toBeGreaterThan(0.9);
      expect(r).toBeLessThanOrEqual(1.0 + 1e-6);
    }
    // uv в [0,1]
    for (const t of g.uvs) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    expect(g.mats.length).toBe(g.positions.length / 3);
  });

  it('нетронутая поверхность чанка лежит на сфере r=1 (крышка)', () => {
    const crust = new Crust();
    crust.carve(SAHARA, 0.02, 2, 42); // маленький удар — большая часть чанка нетронута
    const { face, u, v } = dirToFaceUV(SAHARA);
    const cx = Math.floor((u * CRUST_FACE_N) / CRUST_CHUNK);
    const cy = Math.floor((v * CRUST_FACE_N) / CRUST_CHUNK);
    const g = buildChunkGeo(crust, face, cx, cy)!;
    let atSphere = 0;
    for (let i = 0; i < g.positions.length; i += 3) {
      const r = Math.hypot(g.positions[i]!, g.positions[i + 1]!, g.positions[i + 2]!);
      if (Math.abs(r - 1) < 1e-6) atSphere++;
    }
    expect(atSphere).toBeGreaterThan(10); // крышка нетронутой части прижата к сфере
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run test/crust/chunkGeometry.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализация**

`src/crust/chunkGeometry.ts`:

```ts
// Геометрия чанка коры: Surface Nets в координатах решётки → мировые позиции на cube-sphere.
// Узел решётки (gx,gy,gd) → uv грани ((глоб. столбец + 0.5)/N) → dir; радиус r = 1 − (gd+0.5)·VOX_H.
// Вершина верхней границы (между пустым d=−1 и твёрдым d=0) имеет gd = −0.5 → r = 1 ровно —
// крышка нетронутой части чанка лежит НА сфере, шов с глобусом минимален.
// UV — equirect В КОНВЕНЦИИ СФЕРЫ (v = (lat+π/2)/π, север = 1): тот же сэмпл biome/damage,
// что у GlobeView. Чистый модуль (без three) — тестируется headless.
import { dirToLonLat } from '../sim/geo';
import { Crust, MAT_EMPTY } from './Crust';
import { surfaceNets } from './surfaceNets';
import { faceUVToDir, type FaceId } from './cubesphere';
import { CRUST_FACE_N, CRUST_DEPTH_LAYERS, CRUST_CHUNK, CRUST_VOX_H } from '../assets/config';

const N = CRUST_FACE_N;
const D = CRUST_DEPTH_LAYERS;
const CH = CRUST_CHUNK;

export interface ChunkGeo {
  positions: Float32Array;
  uvs: Float32Array;
  mats: Float32Array;
  indices: Uint32Array;
}

export function buildChunkGeo(crust: Crust, face: FaceId, cx: number, cy: number): ChunkGeo | null {
  const x0 = cx * CH;
  const y0 = cy * CH;
  const solidAt = (lx: number, ly: number, ld: number): boolean =>
    crust.getVoxelExt(face, x0 + lx, y0 + ly, ld) !== MAT_EMPTY;
  const matAt = (lx: number, ly: number, ld: number): number =>
    crust.getVoxelExt(face, x0 + lx, y0 + ly, ld);
  // дедуп квадов между чанками: владелец ребра — чанк, в чей диапазон [0..CH−1] попадает
  // нижняя боковая координата ребра
  const ownQuad = (ex: number, ey: number): boolean => ex >= 0 && ex < CH && ey >= 0 && ey < CH;

  const nets = surfaceNets(solidAt, matAt, CH, CH, D, ownQuad);
  if (nets.tris.length === 0) return null;

  const nVerts = nets.verts.length / 3;
  const positions = new Float32Array(nVerts * 3);
  const uvs = new Float32Array(nVerts * 2);
  const mats = new Float32Array(nets.vmat);
  for (let i = 0; i < nVerts; i++) {
    const gx = nets.verts[i * 3]!;
    const gy = nets.verts[i * 3 + 1]!;
    const gd = nets.verts[i * 3 + 2]!;
    const dir = faceUVToDir(face, (x0 + gx + 0.5) / N, (y0 + gy + 0.5) / N);
    // r=1 на верхней границе (gd=−0.5); не даём вершинам выпирать над сферой из-за джиттера сети
    const r = Math.min(1, 1 - (gd + 0.5) * CRUST_VOX_H);
    positions[i * 3] = dir.x * r;
    positions[i * 3 + 1] = dir.y * r;
    positions[i * 3 + 2] = dir.z * r;
    const { lon, lat } = dirToLonLat(dir);
    uvs[i * 2] = (lon + Math.PI) / (2 * Math.PI);
    uvs[i * 2 + 1] = (lat + Math.PI / 2) / Math.PI;
  }
  return { positions, uvs, mats, indices: new Uint32Array(nets.tris) };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/crust`
Expected: PASS (все crust-тесты).

- [ ] **Step 5: Commit**

```bash
git add src/crust/chunkGeometry.ts test/crust/chunkGeometry.test.ts
git commit -m "feat(crust): геометрия чанка — Surface Nets на cube-sphere, крышка на r=1, equirect-uv"
```

---

### Task 7: `render/HoleMask.ts` — equirect-маска дырок глобуса

**Files:**
- Create: `src/render/HoleMask.ts`
- Create: `src/crust/chunkFootprint.ts` (чистый расчёт полигона чанка в equirect)
- Test: `test/crust/chunkFootprint.test.ts`

**Interfaces:**
- Consumes: `faceUVToDir`, `dirToLonLat`, config.
- Produces:
  - `chunkFootprint(face: FaceId, cx: number, cy: number): { xs: number[]; ys: number[]; wrap: boolean; poleBand: { yMin: number; yMax: number } | null }` — полигон чанка в НОРМИРОВАННЫХ equirect-координатах канвы (x=0..1 по долготе, y=0..1, y=0 — СЕВЕР, как строки биом-канвы); `wrap` — полигон пересекает шов долготы (рисовать дважды со сдвигом ±1); `poleBand` — чанк накрывает полюс (заливать полосу на всю ширину).
  - `class HoleMask { readonly texture: THREE.CanvasTexture; markChunk(face, cx, cy): void; clear(): void }`

- [ ] **Step 1: Падающий тест (чистая часть)**

`test/crust/chunkFootprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chunkFootprint } from '../../src/crust/chunkFootprint';

describe('chunkFootprint', () => {
  it('обычный чанк: полигон в границах, без wrap/полюса', () => {
    // чанк в середине грани +X (экватор, lon≈0) — далеко от шва и полюсов
    const fp = chunkFootprint(0, 3, 3);
    expect(fp.wrap).toBe(false);
    expect(fp.poleBand).toBeNull();
    expect(fp.xs.length).toBeGreaterThanOrEqual(4);
    for (const x of fp.xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    for (const y of fp.ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('чанк через шов долготы помечается wrap', () => {
    // середина грани −X (lon≈180°) — полигон пересекает шов
    const fp = chunkFootprint(1, 3, 3);
    expect(fp.wrap).toBe(true);
  });

  it('полюсный чанк даёт poleBand', () => {
    // угловой-центральный чанк грани +Y накрывает северный полюс
    const fp = chunkFootprint(2, 3, 3);
    expect(fp.poleBand).not.toBeNull();
    expect(fp.poleBand!.yMin).toBeLessThan(0.1); // север — верх канвы (y=0)
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run test/crust/chunkFootprint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация чистой части**

`src/crust/chunkFootprint.ts`:

```ts
// След чанка в equirect-канве (для маски дырок глобуса). Координаты нормированы:
// x = (lon+π)/2π ∈ [0,1], y = (π/2−lat)/π ∈ [0,1] (y=0 — СЕВЕР: как строки биом-канвы,
// canvas flipY=true возвращает соответствие сфере). Периметр чанка сэмплируется по 4 точки
// на сторону (кривизна cube-sphere), шов долготы → wrap, полюс внутри чанка → poleBand.
import { faceUVToDir, type FaceId } from './cubesphere';
import { dirToLonLat } from '../sim/geo';
import { CRUST_FACE_N, CRUST_CHUNK } from '../assets/config';

const N = CRUST_FACE_N;
const CH = CRUST_CHUNK;
const SAMPLES_PER_EDGE = 4;

export interface ChunkFootprint {
  xs: number[];
  ys: number[];
  wrap: boolean;
  poleBand: { yMin: number; yMax: number } | null;
}

export function chunkFootprint(face: FaceId, cx: number, cy: number): ChunkFootprint {
  const u0 = (cx * CH) / N;
  const u1 = ((cx + 1) * CH) / N;
  const v0 = (cy * CH) / N;
  const v1 = ((cy + 1) * CH) / N;
  // периметр чанка по часовой: 4 стороны × SAMPLES_PER_EDGE точек
  const pts: Array<{ u: number; v: number }> = [];
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) pts.push({ u: u0 + ((u1 - u0) * i) / SAMPLES_PER_EDGE, v: v0 });
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) pts.push({ u: u1, v: v0 + ((v1 - v0) * i) / SAMPLES_PER_EDGE });
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) pts.push({ u: u1 - ((u1 - u0) * i) / SAMPLES_PER_EDGE, v: v1 });
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) pts.push({ u: u0, v: v1 - ((v1 - v0) * i) / SAMPLES_PER_EDGE });

  const xs: number[] = [];
  const ys: number[] = [];
  let poleN = false;
  let poleS = false;
  for (const p of pts) {
    const { lon, lat } = dirToLonLat(faceUVToDir(face, p.u, p.v));
    xs.push((lon + Math.PI) / (2 * Math.PI));
    ys.push((Math.PI / 2 - lat) / Math.PI);
  }
  // полюс внутри чанка: грань ±Y и полюсная uv-точка (0.5,0.5) в границах чанка
  if (face === 2 && u0 <= 0.5 && 0.5 <= u1 && v0 <= 0.5 && 0.5 <= v1) poleN = true;
  if (face === 3 && u0 <= 0.5 && 0.5 <= u1 && v0 <= 0.5 && 0.5 <= v1) poleS = true;

  const wrap = Math.max(...xs) - Math.min(...xs) > 0.5;
  let poleBand: ChunkFootprint['poleBand'] = null;
  if (poleN) poleBand = { yMin: 0, yMax: Math.max(...ys) };
  if (poleS) poleBand = { yMin: Math.min(...ys), yMax: 1 };
  return { xs, ys, wrap, poleBand };
}
```

- [ ] **Step 4: Прогнать тест чистой части**

Run: `npx vitest run test/crust/chunkFootprint.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: three-обёртка (без юнита — проверяется приёмкой)**

`src/render/HoleMask.ts`:

```ts
// Equirect-маска «дырок» глобуса: белое = регион, где глобус discard'ится (его заменяет
// воксельный чанк CrustView). Канва в конвенции биом-текстуры (строка 0 = север) +
// flipY=true (по умолчанию CanvasTexture) → сэмпл uv() на сфере совпадает.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import { chunkFootprint } from '../crust/chunkFootprint';
import type { FaceId } from '../crust/cubesphere';

const MASK_W = 1024;
const MASK_H = 512;

export class HoleMask {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly marked = new Set<string>();

  constructor(ctx: ThreeCtx) {
    const { THREE } = ctx;
    const canvas = document.createElement('canvas');
    canvas.width = MASK_W;
    canvas.height = MASK_H;
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error('HoleMask: 2d-контекст недоступен');
    this.ctx2d = c2d;
    this.clearCanvas();
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.wrapS = THREE.RepeatWrapping;
  }

  private clearCanvas(): void {
    this.ctx2d.fillStyle = '#000';
    this.ctx2d.fillRect(0, 0, MASK_W, MASK_H);
  }

  markChunk(face: FaceId, cx: number, cy: number): void {
    const key = `${face}:${cx}:${cy}`;
    if (this.marked.has(key)) return;
    this.marked.add(key);
    const fp = chunkFootprint(face, cx, cy);
    this.ctx2d.fillStyle = '#fff';
    if (fp.poleBand) {
      // полюсный чанк — полоса на всю ширину (equirect-полигон у полюса вырождается)
      const y0 = fp.poleBand.yMin * MASK_H;
      this.ctx2d.fillRect(0, y0, MASK_W, fp.poleBand.yMax * MASK_H - y0);
      this.texture.needsUpdate = true;
      return;
    }
    const draw = (shiftX: number) => {
      this.ctx2d.beginPath();
      for (let i = 0; i < fp.xs.length; i++) {
        // при wrap — приводим все x к одной стороне шва, рисуем дважды со сдвигом
        let x = fp.xs[i]!;
        if (fp.wrap && x < 0.5) x += 1;
        const px = (x + shiftX) * MASK_W;
        const py = fp.ys[i]! * MASK_H;
        if (i === 0) this.ctx2d.moveTo(px, py);
        else this.ctx2d.lineTo(px, py);
      }
      this.ctx2d.closePath();
      this.ctx2d.fill();
    };
    draw(0);
    if (fp.wrap) draw(-1);
    this.texture.needsUpdate = true;
  }

  clear(): void {
    this.marked.clear();
    this.clearCanvas();
    this.texture.needsUpdate = true;
  }
}
```

Run: `npm run lint && npm run build`
Expected: чисто (типы сходятся).

- [ ] **Step 6: Commit**

```bash
git add src/crust/chunkFootprint.ts src/render/HoleMask.ts test/crust/chunkFootprint.test.ts
git commit -m "feat(render): маска дырок глобуса — equirect-канва по следу чанка (wrap/полюс учтены)"
```

---

### Task 8: `render/CrustView.ts` + `render/MagmaCore.ts`

**Files:**
- Create: `src/render/CrustView.ts`
- Create: `src/render/MagmaCore.ts`

**Interfaces:**
- Consumes: `Crust`, `buildChunkGeo`, `HoleMask`, `chunkKey`-формат `'f:cx:cy'`; биом-текстура и damage-текстура (из Scene, Task 10); `fbm3` из `render/noise`.
- Produces:
  - `class CrustView { constructor(ctx: ThreeCtx, parent: THREE.Group, crust: Crust, holeMask: HoleMask, biomeTex: THREE.Texture, damageTex: THREE.Texture); update(changedKeys: string[]): void; clear(): void }`
  - `class MagmaCore { constructor(ctx: ThreeCtx, parent: THREE.Group); setTime(t: number): void }`

- [ ] **Step 1: MagmaCore**

`src/render/MagmaCore.ts`:

```ts
// Магма-подложка под корой: эмиссивная сфера (MeshBasicNodeMaterial = unlit, «светится» сама,
// без динамического света — ограничение движка). Видна только сквозь пробития коры: глобус
// сверху непрозрачен, кора закрывает бока. Пульсация — fbm по positionLocal + uTime.
import type * as THREE from 'three/webgpu';
import { uniform, vec3, mix, positionLocal, clamp } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { MAGMA_R } from '../assets/config';
import { fbm3 } from './noise';

function makeFloatUniform(v: number) {
  return uniform(v);
}

export class MagmaCore {
  private readonly uTime = makeFloatUniform(0);
  readonly mesh: THREE.Mesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    const mat = new THREE.MeshBasicNodeMaterial();
    const n = fbm3(positionLocal.mul(6.0).add(vec3(0, 0, this.uTime.mul(0.15))), 4);
    const glow = clamp(n.mul(1.4), 0, 1);
    mat.colorNode = mix(vec3(0.45, 0.05, 0.0), vec3(1.0, 0.55, 0.1), glow);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(MAGMA_R, 96, 48), mat);
    parent.add(this.mesh);
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }
}
```

- [ ] **Step 2: CrustView**

`src/render/CrustView.ts`:

```ts
// Гибрид-рендер воксельной коры: нетронутые чанки не рисуются вовсе (планета — гладкий глобус);
// задетые carve'ом чанки мешатся Surface Nets и рисуются поверх, а глобус в их регионе
// discard'ится по HoleMask. Один материал на все чанки: цвет по атрибуту aMat
// (грунт → биом-текстура, порода/базальт/дно — палитра) + гарь из DamageField тем же uv.
import type * as THREE from 'three/webgpu';
import { texture, uv, attribute, vec3, mix, clamp, select } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { Crust, MAT_SOIL, MAT_BASALT, MAT_WATER } from '../crust/Crust';
import { buildChunkGeo } from '../crust/chunkGeometry';
import type { FaceId } from '../crust/cubesphere';
import type { HoleMask } from './HoleMask';
import { CRUST_LAYER_COLORS, CRATER_MATERIAL_COLORS } from '../assets/config';

export class CrustView {
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly group: THREE.Group;
  private readonly material: THREE.MeshPhongNodeMaterial;

  constructor(
    private readonly ctx: ThreeCtx,
    parent: THREE.Group,
    private readonly crust: Crust,
    private readonly holeMask: HoleMask,
    biomeTex: THREE.Texture,
    damageTex: THREE.Texture,
  ) {
    const { THREE } = ctx;
    this.group = new THREE.Group();
    parent.add(this.group);

    const mat = new THREE.MeshPhongNodeMaterial({ shininess: 8, specular: 0x111111 });
    const aMat = attribute('aMat', 'float');
    const cl = CRUST_LAYER_COLORS;
    const biome = texture(biomeTex, uv()).rgb;
    // палитра по материал-id: 1=грунт(биом) 2=порода 3=базальт 4=дно океана
    let col = vec3(cl.rock[0], cl.rock[1], cl.rock[2]);
    col = select(aMat.lessThan(MAT_SOIL + 0.5), biome, col);
    col = select(aMat.greaterThan(MAT_BASALT - 0.5), vec3(cl.basalt[0], cl.basalt[1], cl.basalt[2]), col);
    col = select(aMat.greaterThan(MAT_WATER - 0.5), vec3(cl.seabed[0], cl.seabed[1], cl.seabed[2]), col);
    // гарь поверх (канал G поля урона, как на глобусе)
    const dmg = texture(damageTex, uv());
    const cm = CRATER_MATERIAL_COLORS;
    col = mix(col, vec3(cm.scorch[0], cm.scorch[1], cm.scorch[2]), clamp(dmg.g.mul(0.8), 0, 1));
    mat.colorNode = col;
    this.material = mat;
  }

  // Ремешит перечисленные чанки (ключ 'f:cx:cy'): удаляет старый меш, строит новый, метит маску.
  update(changedKeys: string[]): void {
    const { THREE } = this.ctx;
    for (const key of changedKeys) {
      const [f, cx, cy] = key.split(':').map(Number) as [FaceId, number, number];
      const old = this.meshes.get(key);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        this.meshes.delete(key);
      }
      const geo = buildChunkGeo(this.crust, f, cx, cy);
      this.holeMask.markChunk(f, cx, cy);
      if (!geo) continue; // чанк выеден полностью — дырку закрывает магма-сфера
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(geo.uvs, 2));
      g.setAttribute('aMat', new THREE.BufferAttribute(geo.mats, 1));
      g.setIndex(new THREE.BufferAttribute(geo.indices, 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.material);
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
  }

  clear(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.holeMask.clear();
  }
}
```

- [ ] **Step 3: Проверить сборку и закоммитить**

Run: `npm run lint && npm run build`
Expected: чисто. (Юнитов нет — three-обёртки; поведение покрывает приёмка Task 11.)

```bash
git add src/render/CrustView.ts src/render/MagmaCore.ts
git commit -m "feat(render): CrustView (чанки Surface Nets, палитра слоёв+биом+гарь) и магма-подложка"
```

---

### Task 9: GlobeView — discard по маске дырок, демонтаж displacement-кратеров

**Files:**
- Modify: `src/render/GlobeView.ts`
- Modify: `src/render/MaterialGlobe.ts` (ничего) — биом-текстуру наружу отдаёт GlobeView

**Interfaces:**
- Consumes: `HoleMask.texture` (Task 7).
- Produces:
  - `GlobeView` constructor: `(ctx: ThreeCtx, damageTex: THREE.Texture, holeTex: THREE.Texture)`
  - `GlobeView.biomeTexture: THREE.Texture` (readonly-поле — для CrustView)

- [ ] **Step 1: Правки GlobeView**

В `src/render/GlobeView.ts`:

1. Конструктор: `constructor(ctx: ThreeCtx, damageTex: THREE.Texture, holeTex: THREE.Texture)`.
2. Добавить публичное поле `readonly biomeTexture: THREE.Texture;` и присвоить в нём `biomeTex`.
3. **Удалить** displacement и кратерный микрорельеф (морфология теперь воксельная):
   - `earthMaterial.positionNode = ...` (блок с `rimUp`) — удалить;
   - блок `craterMask`/`craterGrad`/`perturbedLocal`/`earthMaterial.normalNode` — удалить;
   - функцию `heightGrad`, тип `Vec3Node` и константы `CRATER_DETAIL_*` в шапке — удалить;
   - из colorNode удалить зоны `dusted`/`rocky`/`glass` (каналы R/A больше не используются) —
     оставить цепочку: `base → scorched (G) → полынья льда (B)`:

```ts
    const cm = CRATER_MATERIAL_COLORS;
    const base = texture(biomeTex, uv()).rgb;
    // гарь — мягкое потемнение биома градиентом по G (морфология кратера — воксельная кора)
    const scorched = mix(
      base,
      vec3(cm.scorch[0], cm.scorch[1], cm.scorch[2]),
      clamp(dmg.g.mul(0.8), 0, 1),
    );
    // лёд-полынья (B): светлая ледяная крошка → тёмная открытая вода в центре
    const iceRim = smoothstep(0.15, 0.4, dmg.b);
    const openWater = smoothstep(0.45, 0.75, dmg.b);
    const withIceRim = mix(scorched, vec3(0.7, 0.78, 0.85), iceRim);
    earthMaterial.colorNode = mix(withIceRim, vec3(0.05, 0.12, 0.2), openWater);
```

4. Discard по маске дырок (после colorNode):

```ts
    // Дырки коры: там, где HoleMask=1, фрагмент глобуса отбрасывается (регион рисует CrustView).
    // alphaTest-путь node-материалов делает discard без transparent-прохода.
    earthMaterial.opacityNode = oneMinus(texture(holeTex, uv()).r);
    earthMaterial.alphaTest = 0.5;
```

5. Почистить неиспользуемые импорты (`positionLocal`, `normalLocal`, `materialNormal`,
   `transformNormalToView`, `select`, `lessThan`, `cross`, `normalize`, `abs`, `fbm3`,
   `MAX_CRATER_DEPTH`, `CRATER_RIM_HEIGHT`, `CRATER_DETAIL_OCTAVES`, `CRATER_DETAIL_STRENGTH`,
   `GLOBE_LON_SEG`-оставить и т.д. — по факту, lint подскажет; `oneMinus` остаётся нужен).

6. В `src/main.ts` — создать маску ДО глобуса и передать:

```ts
  import { HoleMask } from './render/HoleMask';
  // ...
  const damageField = new DamageField(renderer.ctx);
  const holeMask = new HoleMask(renderer.ctx); // маска дырок коры (глобус discard'ит регионы чанков)
  const globe = new GlobeView(renderer.ctx, damageField.texture, holeMask.texture);
```

и передать `holeMask` дальше в `Scene` (Task 10).

- [ ] **Step 2: Проверить**

Run: `npm test && npm run lint && npm run build`
Expected: зелёно. (Тест `craterProfile.test.ts` остаётся зелёным — профиль в DamageField не трогали.)

- [ ] **Step 3: Commit**

```bash
git add src/render/GlobeView.ts src/main.ts
git commit -m "feat(render): GlobeView — discard по маске дырок; displacement-кратеры демонтированы (морфология — воксельная кора)"
```

---

### Task 10: Scene — carve при ударе, reset, магма

**Files:**
- Modify: `src/render/Scene.ts`
- Modify: `src/main.ts` (проброс holeMask в Scene)

**Interfaces:**
- Consumes: `Crust`, `CrustView`, `MagmaCore`, `HoleMask`, `GlobeView.biomeTexture`, config `CRUST_RADIUS_BY_YIELD`, `CRUST_DEPTH_BY_YIELD`.
- Produces: поведение — удар по суше/льду выгрызает кору; reset восстанавливает.

- [ ] **Step 1: Правки Scene**

В `src/render/Scene.ts`:

1. Импорты: `Crust` из `../crust/Crust`, `CrustView`, `MagmaCore`, `HoleMask`,
   `CRUST_RADIUS_BY_YIELD, CRUST_DEPTH_BY_YIELD` из config.
2. Поля: `private readonly crust: Crust; private readonly crustView: CrustView; private readonly magma: MagmaCore;`
3. Конструктор получает `holeMask: HoleMask` (после `damageField`) и `globe` уже есть:

```ts
    // Воксельная кора: состояние + гибрид-рендер + магма-подложка (спека 2026-07-06).
    this.crust = new Crust();
    this.magma = new MagmaCore(ctx, globe.spinGroup);
    this.crustView = new CrustView(
      ctx,
      globe.spinGroup,
      this.crust,
      holeMask,
      globe.biomeTexture,
      damageField.texture,
    );
```

4. В `startExplosion`, ветка суша/лёд (else), после `damageField.splat(...)`:

```ts
      // Выгрызаем кору: воксельная морфология кратера (displacement демонтирован в GlobeView)
      const carved = this.crust.carve(
        dir,
        CRUST_RADIUS_BY_YIELD[yieldMt] ?? 0.02,
        CRUST_DEPTH_BY_YIELD[yieldMt] ?? 3,
        seed,
      );
      this.crustView.update(carved.changed);
```

5. В `handleEvent` ветка `planetReset`: добавить

```ts
        this.crust.reset();
        this.crustView.clear();
```

6. В `update(dt)`: `this.magma.setTime(this.clock);`

7. `src/main.ts`: `new Scene(renderer.ctx, globe, host, rig, damageField, holeMask)` — и
   соответствующий параметр в конструкторе Scene.

- [ ] **Step 2: Проверить**

Run: `npm test && npm run lint && npm run build`
Expected: зелёно.

- [ ] **Step 3: Commit**

```bash
git add src/render/Scene.ts src/main.ts
git commit -m "feat(render): удар по суше/льду выгрызает воксельную кору; reset восстанавливает; магма под корой"
```

---

### Task 11: Приёмка — прогрессия повторных ударов

**Files:**
- Modify: `scripts/accept/shots.mjs`

- [ ] **Step 1: Добавить сценарий в харнесс**

В `scripts/accept/shots.mjs` после блока «Удар по льду» и ПЕРЕД финальным reset-блоком добавить:

```js
    // --- Прогрессия: три удара 100Мт в одну точку (воксельная кора копается до магмы) ---
    console.log('Прогрессия: 3×100Мт в одну точку...');
    await evalJs('window.__reset()');
    await sleep(500);
    await evalJs('window.__lookAt(20, 23)');
    await evalJs('window.__strike(20, 23, 100)');
    await sleep(4000);
    await screenshot('05-crust-hit1.png');
    await evalJs('window.__strike(20, 23, 100)');
    await sleep(4000);
    await screenshot('06-crust-hit2.png');
    await evalJs('window.__strike(20, 23, 100)');
    await sleep(4000);
    await screenshot('07-crust-hit3.png');
    // скол на силуэте: удар по краю видимого диска
    await evalJs('window.__lookAt(60, 10)');
    await sleep(300);
    await screenshot('08-crust-limb.png');
```

- [ ] **Step 2: Полный прогон**

```bash
pkill -f vite; lsof -ti:5173 | xargs kill -9; npm run accept
```

Expected: exit 0, консоль без ошибок шейдеров; на `05..07` воронка углубляется, слои темнеют
(грунт→порода→базальт), на третьем ударе на дне видна светящаяся магма; `08` — скол читается
на силуэте; `04-after-reset` — планета целая (дырки и чанки сброшены).

Проверить глазами (Read PNG) и приложить вывод в итоговое сообщение. Визуальную ДОводку
(палитра, глубины) делает пользователь.

- [ ] **Step 3: Commit**

```bash
git add scripts/accept/shots.mjs
git commit -m "test(accept): сценарий прогрессии воксельной коры — 3 удара в точку + скол на силуэте"
```

---

### Task 12: Банк памяти и финал

**Files:**
- Modify: `memory-bank/activeContext.md` (раздел «Чем занимаемся»), `memory-bank/progress.md`

- [ ] **Step 1: Обновить банк памяти**

В `activeContext.md` — абзац: воксельная кора (этап 1) реализована: `src/crust/`
(cube-sphere 6×256×256×8, ленивые чанки, carve-эллипсоид), Surface Nets мешер,
гибрид-рендер (`CrustView`+`HoleMask`+`MagmaCore`), displacement-кратеры демонтированы;
следующие этапы: обломки (2), трещины/целостность (3), раскол (4) — спека
`docs/superpowers/specs/2026-07-06-voxel-crust-design.md`. В `progress.md` — строка о статусе.

- [ ] **Step 2: Финальная проверка всего**

```bash
npm test && npm run lint && npm run build
```

Expected: все тесты зелёные (67 старых + новые crust), lint/build чисто.

- [ ] **Step 3: Commit**

```bash
git add memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs(memory-bank): воксельная кора этап 1 — реализовано"
```

---

## Self-Review (выполнен при написании)

- **Покрытие спеки:** §4.1 (crust-модуль) → Tasks 2-4; §4.2 (гибрид-рендер, Surface Nets, маска,
  магма) → Tasks 5-9; §4.3 (демонтаж displacement) → Task 9; §4.4 (интеграция/сброс/радиусы) →
  Task 10; §5 (тесты/приёмка) → Tasks 2-6, 11; этап-0 фиксы → Task 1 (+«кратер на воде» решается
  §4.3: displacement удалён, вода не карвится). Раскол/обломки/трещины — вне этапа (спека §3).
- **Плейсхолдеров нет:** каждый код-шаг содержит конкретный код; «по факту, lint подскажет» в
  Task 9 касается только списка удаляемых импортов — сами удаляемые блоки перечислены явно.
- **Согласованность типов:** `CarveResult.changed: string[]` (Task 4) ↔ `CrustView.update(changedKeys: string[])`
  (Task 8) ↔ `carved.changed` (Task 10); `chunkKey` `'f:cx:cy'` единый; `buildChunkGeo` возвращает
  `ChunkGeo|null` — CrustView обрабатывает null; конструктор GlobeView (Task 9) ↔ main.ts (Task 9/10);
  конструктор Scene (Task 10) ↔ main.ts (Task 10).
