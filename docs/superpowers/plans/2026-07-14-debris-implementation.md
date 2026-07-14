# Обломки-глыбы (этап 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разлёт твёрдых 3D-глыб выбитой породы при ударе по суше/льду; часть глыб уходит на орбиту и копится в постоянное кольцо мусора (до reset).

**Architecture:** Спека `docs/superpowers/specs/2026-07-14-debris-design.md`. Один `InstancedMesh` с низкополи-камнем; траектории — замкнутые формулы от `uTime` в TSL (паттерн EjectaView), CPU пишет атрибуты один раз при взрыве. Чистая математика (орбита, счёт глыб, выбор материала, курсоры слотов) — в отдельном модуле `debrisMath.ts` без three.js, под vitest. `Crust.carve` дополнительно возвращает разбивку выбитого по материалам.

**Tech Stack:** TypeScript, three.js WebGPU + TSL (узловые материалы), vitest.

## Global Constraints

- Общение и комментарии в коде — на русском (CLAUDE.md).
- Никакого динамического света; NodeMaterial-грабли: непрозрачный материал НЕ трогает opacity, клампить выходы цвета ≥0, исчезновение — масштабом, не альфой.
- Ноль аллокаций/работы CPU на кадр в путях рендера; детерминизм от seed (LCG `s = s*16807 % 2147483647`, как EjectaView).
- Никакого `Math.random` в рантайме — только детерминированные хеши/LCG.
- Ветка `feat/debris` от master; коммиты частые, сообщения на русском с Co-Authored-By Claude.
- Визуальную приёмку (скриншот-харнесс) НЕ гоняем — юзер смотрит сам. Проверка: `npm test`, `npm run build` (включает `tsc --noEmit`).

---

### Task 1: Crust.carve — разбивка выбитого по материалам

**Files:**
- Modify: `src/crust/Crust.ts` (интерфейс `CarveResult` ~строка 41, тело `carve` ~строки 195-224)
- Test: `test/crust/carve.test.ts` (дописать describe)

**Interfaces:**
- Produces: `CarveResult.removedByMat: { soil: number; rock: number; basalt: number }` — сумма полей === `removed`. Потребляется Task 3 (`DebrisView.emit`) и Task 4 (Scene).

- [ ] **Step 1: Написать падающий тест**

В конец `test/crust/carve.test.ts` (внутрь `describe('Crust.carve', ...)` перед закрывающей скобкой, рядом с остальными `it`):

```ts
  it('removedByMat раскладывает выбитое по материалам и суммируется в removed', () => {
    const crust = new Crust();
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    const { soil, rock, basalt } = res.removedByMat;
    expect(soil + rock + basalt).toBe(res.removed);
    // глубокий удар (5 слоёв) задевает и грунт (слои 0-1), и породу (2-4)
    expect(soil).toBeGreaterThan(0);
    expect(rock).toBeGreaterThan(0);
    // детерминизм разбивки
    const again = new Crust().carve(SAHARA, 0.046, 5, 42);
    expect(again.removedByMat).toEqual(res.removedByMat);
  });

  it('removedByMat нулевой при ударе по океану', () => {
    const res = new Crust().carve(PACIFIC, 0.046, 5, 42);
    expect(res.removedByMat).toEqual({ soil: 0, rock: 0, basalt: 0 });
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/crust/carve.test.ts`
Expected: FAIL — `removedByMat` undefined.

- [ ] **Step 3: Минимальная реализация**

В `src/crust/Crust.ts`:

1. Расширить интерфейс:

```ts
export interface CarveResult {
  changed: string[]; // ключи чанков на ремеш (задетые + боковые соседи)
  removed: number; // сколько вокселей выбито этим ударом
  removedByMat: { soil: number; rock: number; basalt: number }; // разбивка removed по материалам
}
```

2. В `carve()` рядом с `let removed = 0;` добавить:

```ts
    const removedByMat = { soil: 0, rock: 0, basalt: 0 };
```

3. В цикле по глубине, сразу после `chunk[idx] = MAT_EMPTY;` (перед `removed++`):

```ts
                if (m === MAT_SOIL) removedByMat.soil++;
                else if (m === MAT_ROCK) removedByMat.rock++;
                else removedByMat.basalt++;
```

4. Вернуть поле: `return { changed: [...changed].sort(), removed, removedByMat };`

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/crust`
Expected: PASS (все крастовые тесты; существующие не трогаем).

- [ ] **Step 5: Commit**

```bash
git add src/crust/Crust.ts test/crust/carve.test.ts
git commit -m "feat(crust): CarveResult.removedByMat — разбивка выбитых вокселей по материалам"
```

---

### Task 2: debrisMath — чистая математика глыб + конфиг

**Files:**
- Create: `src/render/debrisMath.ts`
- Modify: `src/assets/config.ts` (в конец файла)
- Test: `test/render/debrisMath.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `dot` из `src/sim/geo`; константы конфига (ниже).
- Produces (для Task 3):
  - `orthoBasis(n: Vec3): { t1: Vec3; t2: Vec3 }` — касательный базис, ТОТ ЖЕ алгоритм, что TSL-граф EjectaView (`t1 = |n.y|<0.99 ? normalize(cross(n, up)) : (1,0,0)`).
  - `orbitalPos(n: Vec3, angle: number, omega: number, orbitR: number, ascentT: number, tau: number): Vec3` — CPU-зеркало орбитальной ветки TSL.
  - `landingDir(n: Vec3, angle: number, dist: number): Vec3` — направление точки приземления баллистической глыбы.
  - `debrisCount(removed: number): number` — сколько глыб на удар.
  - `pickMaterial(r01: number, byMat: { soil: number; rock: number; basalt: number }): 'soil' | 'rock' | 'basalt'`.
  - `class DebrisSlots { constructor(orbitSlots, ballisticSlots); nextOrbital(): number; nextBallistic(): number; reset(): void }` — кольцевые курсоры двух сегментов одного инстанс-буфера: орбитальные индексы в `[0, orbitSlots)`, баллистические в `[orbitSlots, orbitSlots+ballisticSlots)`.

- [ ] **Step 1: Конфиг**

В конец `src/assets/config.ts`:

```ts
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
```

- [ ] **Step 2: Написать падающие тесты**

`test/render/debrisMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  orthoBasis,
  orbitalPos,
  landingDir,
  debrisCount,
  pickMaterial,
  DebrisSlots,
} from '../../src/render/debrisMath';
import { dot, type Vec3 } from '../../src/sim/geo';
import { DEBRIS_MIN, DEBRIS_MAX } from '../../src/assets/config';

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const N: Vec3 = { x: 0.6, y: 0.48, z: 0.64 }; // |N| = 1

describe('orthoBasis', () => {
  it('даёт ортонормированный базис, перпендикулярный нормали', () => {
    const { t1, t2 } = orthoBasis(N);
    expect(len(t1)).toBeCloseTo(1, 6);
    expect(len(t2)).toBeCloseTo(1, 6);
    expect(dot(t1, N)).toBeCloseTo(0, 6);
    expect(dot(t2, N)).toBeCloseTo(0, 6);
    expect(dot(t1, t2)).toBeCloseTo(0, 6);
  });

  it('не вырождается на полюсе (n ≈ +Y)', () => {
    const { t1, t2 } = orthoBasis({ x: 0, y: 1, z: 0 });
    expect(len(t1)).toBeCloseTo(1, 6);
    expect(len(t2)).toBeCloseTo(1, 6);
  });
});

describe('orbitalPos', () => {
  const angle = 1.1,
    omega = 0.4,
    orbitR = 1.4,
    ascentT = 6;

  it('при tau=0 стартует из точки запуска (на поверхности, вдоль n)', () => {
    const p = orbitalPos(N, angle, omega, orbitR, ascentT, 0);
    expect(len(p)).toBeCloseTo(1, 5);
    expect(dot(p, N)).toBeCloseTo(1, 5);
  });

  it('после взлёта радиус выходит на орбитальный', () => {
    const p = orbitalPos(N, angle, omega, orbitR, ascentT, ascentT + 1);
    expect(len(p)).toBeCloseTo(orbitR, 5);
  });

  it('периодична после взлёта: pos(t) ≈ pos(t + 2π/ω)', () => {
    const t0 = ascentT + 2;
    const a = orbitalPos(N, angle, omega, orbitR, ascentT, t0);
    const b = orbitalPos(N, angle, omega, orbitR, ascentT, t0 + (2 * Math.PI) / omega);
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.y).toBeCloseTo(b.y, 5);
    expect(a.z).toBeCloseTo(b.z, 5);
  });
});

describe('landingDir', () => {
  it('единичный вектор, смещённый от эпицентра', () => {
    const d = landingDir(N, 0.3, 0.1);
    expect(len(d)).toBeCloseTo(1, 6);
    expect(dot(d, N)).toBeLessThan(1);
    expect(dot(d, N)).toBeGreaterThan(0.9); // смещение мало
  });
});

describe('debrisCount', () => {
  it('0 выбитых → 0 глыб; иначе кламп [MIN, MAX]', () => {
    expect(debrisCount(0)).toBe(0);
    expect(debrisCount(1)).toBe(DEBRIS_MIN);
    expect(debrisCount(10_000)).toBe(DEBRIS_MAX);
    expect(debrisCount(300)).toBe(100); // 300 · (1/3)
  });
});

describe('pickMaterial', () => {
  const byMat = { soil: 50, rock: 30, basalt: 20 };
  it('делит [0,1) пропорционально долям материалов', () => {
    expect(pickMaterial(0.0, byMat)).toBe('soil');
    expect(pickMaterial(0.49, byMat)).toBe('soil');
    expect(pickMaterial(0.51, byMat)).toBe('rock');
    expect(pickMaterial(0.79, byMat)).toBe('rock');
    expect(pickMaterial(0.81, byMat)).toBe('basalt');
    expect(pickMaterial(0.999, byMat)).toBe('basalt');
  });
  it('пустая разбивка не делит на ноль', () => {
    expect(pickMaterial(0.5, { soil: 0, rock: 0, basalt: 0 })).toBe('rock');
  });
});

describe('DebrisSlots', () => {
  it('орбитальные и баллистические сегменты не пересекаются и заворачиваются', () => {
    const s = new DebrisSlots(3, 2);
    expect([s.nextOrbital(), s.nextOrbital(), s.nextOrbital(), s.nextOrbital()]).toEqual([
      0, 1, 2, 0,
    ]);
    expect([s.nextBallistic(), s.nextBallistic(), s.nextBallistic()]).toEqual([3, 4, 3]);
  });
  it('reset обнуляет курсоры', () => {
    const s = new DebrisSlots(3, 2);
    s.nextOrbital();
    s.nextBallistic();
    s.reset();
    expect(s.nextOrbital()).toBe(0);
    expect(s.nextBallistic()).toBe(3);
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npx vitest run test/render/debrisMath.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 4: Реализация**

`src/render/debrisMath.ts`:

```ts
// Чистая математика обломков-глыб (без three.js) — CPU-зеркала TSL-веток DebrisView и
// вспомогательная логика emit. Вынесена отдельно, чтобы тестироваться headless (vitest).
import type { Vec3 } from '../sim/geo';
import { DEBRIS_PER_VOXEL, DEBRIS_MIN, DEBRIS_MAX } from '../assets/config';

function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// Касательный базис из нормали — ТОТ ЖЕ алгоритм, что TSL-граф EjectaView/DebrisView
// (t1 = |n.y|<0.99 ? normalize(cross(n, up)) : (1,0,0)); менять только синхронно с шейдером.
export function orthoBasis(n: Vec3): { t1: Vec3; t2: Vec3 } {
  const t1 =
    Math.abs(n.y) < 0.99 ? norm3(cross3(n, { x: 0, y: 1, z: 0 })) : { x: 1, y: 0, z: 0 };
  const t2 = norm3(cross3(n, t1));
  return { t1, t2 };
}

// smoothstep(0,1,x) с клампом — как в TSL.
function smooth01(x: number): number {
  const s = Math.min(1, Math.max(0, x));
  return s * s * (3 - 2 * s);
}

// Орбитальная ветка: спиральный взлёт с поверхности (r=1) на орбиту r=orbitR за ascentT сек,
// далее вечное кружение в плоскости (n, e2), e2 = t1·cos(angle) + t2·sin(angle).
// При tau=0 позиция = n (точка запуска). CPU-зеркало орбитальной ветки TSL DebrisView.
export function orbitalPos(
  n: Vec3,
  angle: number,
  omega: number,
  orbitR: number,
  ascentT: number,
  tau: number,
): Vec3 {
  const { t1, t2 } = orthoBasis(n);
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  const e2: Vec3 = {
    x: t1.x * ca + t2.x * sa,
    y: t1.y * ca + t2.y * sa,
    z: t1.z * ca + t2.z * sa,
  };
  const theta = omega * tau;
  const r = 1 + (orbitR - 1) * smooth01(tau / ascentT);
  const ct = Math.cos(theta),
    st = Math.sin(theta);
  return {
    x: (n.x * ct + e2.x * st) * r,
    y: (n.y * ct + e2.y * st) * r,
    z: (n.z * ct + e2.z * st) * r,
  };
}

// Направление точки приземления баллистической глыбы: эпицентр n, снос по касательной
// под азимутом angle на дугу dist (единицы радиуса ≈ радианы при малых dist).
export function landingDir(n: Vec3, angle: number, dist: number): Vec3 {
  const { t1, t2 } = orthoBasis(n);
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  return norm3({
    x: n.x + (t1.x * ca + t2.x * sa) * dist,
    y: n.y + (t1.y * ca + t2.y * sa) * dist,
    z: n.z + (t1.z * ca + t2.z * sa) * dist,
  });
}

// Сколько глыб породить на удар: пропорция от выбитых вокселей, кламп [MIN, MAX]; 0 → 0.
export function debrisCount(removed: number): number {
  if (removed <= 0) return 0;
  return Math.min(DEBRIS_MAX, Math.max(DEBRIS_MIN, Math.round(removed * DEBRIS_PER_VOXEL)));
}

// Выбор материала глыбы пропорционально разбивке выбитого (r01 — равномерный [0,1)).
export function pickMaterial(
  r01: number,
  byMat: { soil: number; rock: number; basalt: number },
): 'soil' | 'rock' | 'basalt' {
  const total = byMat.soil + byMat.rock + byMat.basalt;
  if (total <= 0) return 'rock';
  let t = r01 * total;
  if (t < byMat.soil) return 'soil';
  t -= byMat.soil;
  return t < byMat.rock ? 'rock' : 'basalt';
}

// Кольцевые курсоры двух сегментов одного инстанс-буфера DebrisView:
// орбитальный сегмент [0, orbitSlots) — вечные глыбы, вытесняется самая старая;
// баллистический [orbitSlots, orbitSlots+ballisticSlots) — конечная жизнь, переиспользование.
export class DebrisSlots {
  private orbit = 0;
  private ball = 0;

  constructor(
    private readonly orbitSlots: number,
    private readonly ballisticSlots: number,
  ) {}

  nextOrbital(): number {
    const i = this.orbit;
    this.orbit = (this.orbit + 1) % this.orbitSlots;
    return i;
  }

  nextBallistic(): number {
    const i = this.ball;
    this.ball = (this.ball + 1) % this.ballisticSlots;
    return this.orbitSlots + i;
  }

  reset(): void {
    this.orbit = 0;
    this.ball = 0;
  }
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npx vitest run test/render/debrisMath.test.ts`
Expected: PASS (8 тестов).

- [ ] **Step 6: Commit**

```bash
git add src/render/debrisMath.ts src/assets/config.ts test/render/debrisMath.test.ts
git commit -m "feat(render): debrisMath — орбита/приземление/счёт/материал/курсоры глыб + конфиг"
```

---

### Task 3: DebrisView — инстанс-глыбы с TSL-траекториями

**Files:**
- Create: `src/render/DebrisView.ts`

**Interfaces:**
- Consumes: `debrisMath` (Task 2), конфиг (Task 2), `CarveResult.removedByMat` (Task 1), `EJECTA_GRAVITY` из конфига, паттерн EjectaView (кольцевой буфер атрибутов, `makeFloatUniform`).
- Produces (для Task 5):
  - `class DebrisView { constructor(ctx: ThreeCtx, parent: THREE.Group) }`
  - `emit(dir: Vec3, yieldMt: number, seed: number, now: number, removedByMat: { soil: number; rock: number; basalt: number }): DebrisLanding[]` — возвращает приземления баллистических глыб.
  - `interface DebrisLanding { dir: Vec3; at: number }` (`at` — абсолютное время часов рендера).
  - `setTime(t: number): void`, `clear(): void`.

Юнит-тестов на сам класс нет (TSL/GPU); вся выносимая логика уже покрыта в Task 2. Проверка — компиляция (`npm run build` в Task 5) и ручной визуал юзером.

- [ ] **Step 1: Реализация**

`src/render/DebrisView.ts`:

```ts
// Обломки-глыбы (этап 2 разрушаемости, спека 2026-07-14): инстансированные низкополи-камни.
// Баллистические — взлёт/падение параболой (как EjectaView), гаснут схлопыванием масштаба;
// орбитальные — спиральный взлёт и вечное кружение (кольцо мусора, копится до reset).
// Движение целиком в TSL от uTime из пер-инстансных атрибутов; CPU пишет атрибуты один раз
// в emit(). Материал непрозрачный (никакой альфы/сортировки), псевдоламберт от фиксированного
// направления — динамического света в проекте нет.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  instancedBufferAttribute,
  float,
  vec3,
  clamp,
  max,
  sin,
  cos,
  cross,
  normalize,
  abs,
  oneMinus,
  mix,
  dot,
  lessThan,
  select,
  smoothstep,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { landingDir, pickMaterial, debrisCount, DebrisSlots } from './debrisMath';
import {
  DEBRIS_ORBIT_SLOTS,
  DEBRIS_BALLISTIC_SLOTS,
  DEBRIS_ORBIT_FRAC,
  DEBRIS_SPEED_BY_YIELD,
  DEBRIS_ORBIT_R_MIN,
  DEBRIS_ORBIT_R_MAX,
  DEBRIS_ASCENT_T,
  DEBRIS_OMEGA_MIN,
  DEBRIS_OMEGA_MAX,
  DEBRIS_SIZE_MIN,
  DEBRIS_SIZE_MAX,
  DEBRIS_SOIL_COLOR,
  CRUST_LAYER_COLORS,
  EJECTA_GRAVITY,
} from '../assets/config';

const CAPACITY = DEBRIS_ORBIT_SLOTS + DEBRIS_BALLISTIC_SLOTS;

// Приземление баллистической глыбы: где и когда пыхнуть пылью (Scene → EjectaView.emitPuff).
export interface DebrisLanding {
  dir: Vec3;
  at: number;
}

function makeFloatUniform(v: number) {
  return uniform(v);
}

// Низкополи-«рваный» камень: икосаэдр с детерминированным джиттером вершин. Вершины
// PolyhedronGeometry дублированы по граням — хеш берётся от ИСХОДНОЙ позиции, поэтому
// дубликаты одной вершины смещаются одинаково и грани не рвутся; нормали пересчитываются
// плоскими (гранёный вид, как у кусков Surface Nets).
function buildRockGeometry(ctx: ThreeCtx): THREE.BufferGeometry {
  const geo = new ctx.THREE.IcosahedronGeometry(1, 0);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 0.72 + (h - Math.floor(h)) * 0.55; // 0.72..1.27
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class DebrisView {
  private readonly uTime = makeFloatUniform(0);
  private readonly aA: Float32Array; // (spawn, life, flag, angle)   flag: 0=баллистика, 1=орбита
  private readonly aB: Float32Array; // (v0, rSpeed, omega, orbitR)
  private readonly aC: Float32Array; // (dirX, dirY, dirZ, rotSpeed)
  private readonly aD: Float32Array; // (axisX, axisY, axisZ, rotPhase)
  private readonly aE: Float32Array; // (scaleX, scaleY, scaleZ, pad)
  private readonly aF: Float32Array; // (colR, colG, colB, pad)
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly slots = new DebrisSlots(DEBRIS_ORBIT_SLOTS, DEBRIS_BALLISTIC_SLOTS);
  private dirty = false;

  readonly mesh: THREE.InstancedMesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    this.aA = new Float32Array(CAPACITY * 4);
    this.aB = new Float32Array(CAPACITY * 4);
    this.aC = new Float32Array(CAPACITY * 4);
    this.aD = new Float32Array(CAPACITY * 4);
    this.aE = new Float32Array(CAPACITY * 4);
    this.aF = new Float32Array(CAPACITY * 4);
    // Незанятые слоты: spawn=+∞ → pt<0 → масштаб 0 (невидимы); life=1 против деления на ноль.
    for (let i = 0; i < CAPACITY; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1;
    }
    this.attrs = [this.aA, this.aB, this.aC, this.aD, this.aE, this.aF].map((arr) => {
      const attr = new THREE.InstancedBufferAttribute(arr, 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    });

    this.mesh = new THREE.InstancedMesh(buildRockGeometry(ctx), this.buildMaterial(ctx), CAPACITY);
    this.mesh.frustumCulled = false; // позиции задаются в шейдере
    parent.add(this.mesh);
  }

  // TSL-граф: масштаб → кувыркание (Родриг) → траектория (select орбита/баллистика).
  // CPU-зеркала формул — debrisMath.orbitalPos / EjectaView.ballisticHeight; менять синхронно.
  private buildMaterial(ctx: ThreeCtx): THREE.MeshBasicNodeMaterial {
    const { THREE } = ctx;
    const [atA, atB, atC, atD, atE, atF] = this.attrs;
    const aA = instancedBufferAttribute<'vec4'>(atA, 'vec4');
    const aB = instancedBufferAttribute<'vec4'>(atB, 'vec4');
    const aC = instancedBufferAttribute<'vec4'>(atC, 'vec4');
    const aD = instancedBufferAttribute<'vec4'>(atD, 'vec4');
    const aE = instancedBufferAttribute<'vec4'>(atE, 'vec4');
    const aF = instancedBufferAttribute<'vec4'>(atF, 'vec4');

    const spawn = aA.x;
    const life = aA.y;
    const orbital = aA.z; // 0/1
    const angle = aA.w;
    const v0 = aB.x;
    const rSpeed = aB.y;
    const omega = aB.z;
    const orbitR = aB.w;
    const n = normalize(aC.xyz);
    const rotSpeed = aC.w;
    const axis = normalize(aD.xyz);
    const rotPhase = aD.w;
    const scaleV = aE.xyz;
    const baseColor = aF.xyz;

    const pt = this.uTime.sub(spawn);
    const tau = max(pt, 0);
    const lk = clamp(pt.div(life), 0, 1); // прогресс жизни (баллистика)

    // Гейт видимости: до рождения — 0; баллистика схлопывается к приземлению (масштабом,
    // не альфой — материал непрозрачный); орбитальные живут вечно.
    const alive = select(lessThan(pt, float(0)), float(0), float(1));
    const ballShrink = oneMinus(smoothstep(float(0.75), float(1), lk));
    const shrink = alive.mul(select(orbital.greaterThan(0.5), float(1), ballShrink));

    // Кувыркание: поворот Родрига вокруг axis на угол rotSpeed·tau + rotPhase.
    const p0 = ctx.positionLocalOf ? ctx.positionLocalOf() : null; // (не используется — см. ниже)
    void p0;
    const { positionLocal, normalLocal } = ctx.tsl;
    const pScaled = positionLocal.mul(scaleV).mul(shrink);
    const rotA = rotSpeed.mul(tau).add(rotPhase);
    const cr = cos(rotA);
    const sr = sin(rotA);
    const rotate = (v: ReturnType<typeof vec3>) =>
      v
        .mul(cr)
        .add(cross(axis, v).mul(sr))
        .add(axis.mul(dot(axis, v)).mul(oneMinus(cr)));
    const pRot = rotate(pScaled);
    const nRot = rotate(normalLocal);

    // Касательный базис эпицентра (тот же алгоритм, что orthoBasis/EjectaView).
    const up = vec3(0, 1, 0);
    const t1 = select(lessThan(abs(n.y), 0.99), normalize(cross(n, up)), vec3(1, 0, 0));
    const t2 = normalize(cross(n, t1));
    const tangent = t1.mul(cos(angle)).add(t2.mul(sin(angle)));

    // Баллистика: h = v0·tau − ½g·tau² (кламп 0), снос rSpeed·tau (зеркало EjectaView).
    const g = float(EJECTA_GRAVITY);
    const h = max(v0.mul(tau).sub(g.mul(tau).mul(tau).mul(0.5)), 0);
    const posBall = n.mul(float(1).add(h)).add(tangent.mul(rSpeed.mul(tau)));

    // Орбита: θ=ω·tau, r: 1 → orbitR за DEBRIS_ASCENT_T (зеркало debrisMath.orbitalPos).
    const theta = omega.mul(tau);
    const rr = mix(float(1), orbitR, smoothstep(float(0), float(DEBRIS_ASCENT_T), tau));
    const posOrb = n.mul(cos(theta)).add(tangent.mul(sin(theta))).mul(rr);

    const center = select(orbital.greaterThan(0.5), posOrb, posBall);

    // Псевдоламберт от фиксированного направления (динамического света нет) + подсветка низа.
    const light = vec3(0.5, 0.75, 0.44); // нормировано ≈ (0.49, 0.73, 0.43)
    const shade = float(0.45).add(max(dot(normalize(nRot), normalize(light)), 0).mul(0.55));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = center.add(pRot);
    material.colorNode = clamp(baseColor.mul(shade), 0, 1);
    return material;
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Пишет атрибуты одной глыбы в слот i. Только присваивания в готовые массивы.
  private writeDebris(
    i: number,
    spawn: number,
    life: number,
    flag: number,
    angle: number,
    v0: number,
    rSpeed: number,
    omega: number,
    orbitR: number,
    dir: Vec3,
    rotSpeed: number,
    axis: Vec3,
    rotPhase: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    gcol: number,
    b: number,
  ): void {
    const o = i * 4;
    this.aA[o] = spawn;
    this.aA[o + 1] = life;
    this.aA[o + 2] = flag;
    this.aA[o + 3] = angle;
    this.aB[o] = v0;
    this.aB[o + 1] = rSpeed;
    this.aB[o + 2] = omega;
    this.aB[o + 3] = orbitR;
    this.aC[o] = dir.x;
    this.aC[o + 1] = dir.y;
    this.aC[o + 2] = dir.z;
    this.aC[o + 3] = rotSpeed;
    this.aD[o] = axis.x;
    this.aD[o + 1] = axis.y;
    this.aD[o + 2] = axis.z;
    this.aD[o + 3] = rotPhase;
    this.aE[o] = sx;
    this.aE[o + 1] = sy;
    this.aE[o + 2] = sz;
    this.aF[o] = r;
    this.aF[o + 1] = gcol;
    this.aF[o + 2] = b;
    this.dirty = true;
  }

  // Порождает глыбы удара. Детерминированный LCG от seed (как EjectaView.emit). Возвращает
  // приземления баллистических глыб — Scene превратит их в пыхи пыли (EjectaView.emitPuff).
  emit(
    dir: Vec3,
    yieldMt: number,
    seed: number,
    now: number,
    removedByMat: { soil: number; rock: number; basalt: number },
  ): DebrisLanding[] {
    const removed = removedByMat.soil + removedByMat.rock + removedByMat.basalt;
    const count = debrisCount(removed);
    if (count === 0) return [];
    const speedBase = DEBRIS_SPEED_BY_YIELD[yieldMt] ?? 0.2;

    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const TWO_PI = Math.PI * 2;
    const landings: DebrisLanding[] = [];

    for (let i = 0; i < count; i++) {
      const orbital = rnd() < DEBRIS_ORBIT_FRAC;
      const angle = rnd() * TWO_PI;
      // Цвет по материалу выбитого: грунт — конфиг, порода/базальт — палитра коры; джиттер яркости.
      const m = pickMaterial(rnd(), removedByMat);
      const [cr, cg, cb] =
        m === 'soil' ? DEBRIS_SOIL_COLOR : m === 'rock' ? CRUST_LAYER_COLORS.rock : CRUST_LAYER_COLORS.basalt;
      const bright = 0.85 + rnd() * 0.3;
      // Неравномерный пер-осевой масштаб — «рваность» силуэта без новых геометрий.
      const size = DEBRIS_SIZE_MIN + rnd() * (DEBRIS_SIZE_MAX - DEBRIS_SIZE_MIN);
      const sx = size * (0.7 + rnd() * 0.6);
      const sy = size * (0.7 + rnd() * 0.6);
      const sz = size * (0.7 + rnd() * 0.6);
      // Ось кувыркания — равномерно по сфере (детерминированно, из того же LCG).
      const az = rnd() * TWO_PI;
      const cz = rnd() * 2 - 1;
      const sxy = Math.sqrt(Math.max(0, 1 - cz * cz));
      const axis = { x: sxy * Math.cos(az), y: sxy * Math.sin(az), z: cz };
      const rotSpeed = (1 + rnd() * 3) * (rnd() < 0.5 ? -1 : 1);
      const rotPhase = rnd() * TWO_PI;

      if (orbital) {
        const omega = (DEBRIS_OMEGA_MIN + rnd() * (DEBRIS_OMEGA_MAX - DEBRIS_OMEGA_MIN)) *
          (rnd() < 0.5 ? -1 : 1);
        const orbitR = DEBRIS_ORBIT_R_MIN + rnd() * (DEBRIS_ORBIT_R_MAX - DEBRIS_ORBIT_R_MIN);
        this.writeDebris(
          this.slots.nextOrbital(),
          now, 1, 1, angle, 0, 0, omega, orbitR,
          dir, rotSpeed, axis, rotPhase, sx, sy, sz,
          cr * bright, cg * bright, cb * bright,
        );
      } else {
        const v0 = speedBase * (0.5 + rnd() * 0.9);
        const rSpeed = v0 * (0.3 + rnd() * 0.7);
        const life = (2 * v0) / EJECTA_GRAVITY;
        this.writeDebris(
          this.slots.nextBallistic(),
          now, life, 0, angle, v0, rSpeed, 0, 1,
          dir, rotSpeed, axis, rotPhase, sx, sy, sz,
          cr * bright, cg * bright, cb * bright,
        );
        landings.push({ dir: landingDir(dir, angle, rSpeed * life), at: now + life });
      }
    }

    this.flush();
    return landings;
  }

  // Сброс планеты: все слоты в «никогда не родится», курсоры в начало.
  clear(): void {
    for (let i = 0; i < CAPACITY; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1;
    }
    this.slots.reset();
    this.dirty = true;
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    for (const attr of this.attrs) attr.needsUpdate = true;
    this.dirty = false;
  }
}
```

**ВАЖНО — правки против ошибок компиляции (сделать при реализации, это НЕ TODO для потом):**
- Убрать из кода выше строки с `ctx.positionLocalOf` / `ctx.tsl` — это описка плана; `positionLocal` и `normalLocal` импортируются напрямую из `'three/tsl'` (добавить в общий import сверху, как в MagmaCore: `import { ..., positionLocal, normalLocal } from 'three/tsl'`).
- `orbital.greaterThan(0.5)` — если у узла нет метода `greaterThan` в типах, заменить оба ветвления на `select(lessThan(orbital, float(0.5)), <ballistic>, <orbital>)` (метод `lessThan` гарантированно есть — используется в EjectaView).
- Хелпер `rotate(...)` типизировать как `(v: TSLNode) => TSLNode` через `ReturnType<typeof vec3>` только если tsc не выведет сам; при трениях с типами — продублировать выражение Родрига для `pScaled` и `normalLocal` без хелпера (два явных выражения).

- [ ] **Step 2: Проверка компиляции**

Run: `npx tsc --noEmit`
Expected: 0 ошибок. (DebrisView ещё ни к чему не подключён — это нормально.)

- [ ] **Step 3: Commit**

```bash
git add src/render/DebrisView.ts
git commit -m "feat(render): DebrisView — инстанс-глыбы, баллистика + вечная орбита в TSL"
```

---

### Task 4: EjectaView.emitPuff — пых пыли в заданный момент

**Files:**
- Modify: `src/render/EjectaView.ts` (после метода `emit`, ~строка 230)

**Interfaces:**
- Consumes: существующие `writeParticle`/`flush`.
- Produces (для Task 5): `emitPuff(dir: Vec3, spawn: number, seed: number): void` — 4 маленьких частицы пыли, невидимы до момента `spawn` (может быть в будущем — атрибутная задержка, CPU-планировщик не нужен).

- [ ] **Step 1: Реализация**

В `src/render/EjectaView.ts` после метода `emit()`:

```ts
  // Маленький пых пыли в точке dir в момент spawn (абсолютное время часов; МОЖЕТ быть в
  // будущем — частица невидима, пока uTime < spawn, см. fadeIn/alive в buildMaterial).
  // Используется для приземлений глыб DebrisView: все пыхи пишутся сразу в момент взрыва.
  emitPuff(dir: Vec3, spawn: number, seed: number): void {
    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const angle = rnd() * TWO_PI;
      const v0 = 0.02 + rnd() * 0.03;
      const rSpeed = v0 * (0.5 + rnd());
      const life = (2 * v0) / EJECTA_GRAVITY;
      this.writeParticle(
        spawn,
        life,
        Math.min(0.1, life * 0.3),
        angle,
        v0,
        rSpeed,
        0,
        0.008 + rnd() * 0.008,
        dir.x,
        dir.y,
        dir.z,
      );
    }
    this.flush();
  }
```

- [ ] **Step 2: Проверка компиляции**

Run: `npx tsc --noEmit`
Expected: 0 ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/render/EjectaView.ts
git commit -m "feat(render): EjectaView.emitPuff — отложенный пых пыли (приземление глыб)"
```

---

### Task 5: Интеграция в Scene + полная проверка

**Files:**
- Modify: `src/render/Scene.ts` (импорты ~строки 12-32, конструктор ~строка 69, `handleEvent` case 'planetReset' ~строка 103, `startExplosion` ветка суши ~строки 133-148, `update` ~строка 169)

**Interfaces:**
- Consumes: `DebrisView.emit/clear/setTime`, `DebrisLanding` (Task 3), `EjectaView.emitPuff` (Task 4), `carved.removedByMat` (Task 1), `DEBRIS_PUFF_MAX` (Task 2).

- [ ] **Step 1: Подключить DebrisView**

В `src/render/Scene.ts`:

1. Импорты:

```ts
import { DebrisView } from './DebrisView';
```

и в импорт из конфига добавить `DEBRIS_PUFF_MAX`:

```ts
import {
  WATER_SPLAT_STRENGTH,
  WATER_SPLAT_RADIUS,
  CRUST_RADIUS_BY_YIELD,
  CRUST_DEPTH_BY_YIELD,
  DEBRIS_PUFF_MAX,
} from '../assets/config';
```

2. Поле класса (рядом с `ejectaView`):

```ts
  private readonly debrisView: DebrisView;
```

3. В конструкторе после `this.ejectaView = new EjectaView(ctx, globe.spinGroup);`:

```ts
    this.debrisView = new DebrisView(ctx, globe.spinGroup);
```

4. В `case 'planetReset':` после `this.crustView.clear();`:

```ts
        this.debrisView.clear();
```

5. В `startExplosion`, в ветке суши/льда, после `this.holeMask.markCarve(...)`:

```ts
      // Глыбы выбитой породы: разлёт + пополнение орбитального кольца (этап 2, спека
      // 2026-07-14). Приземления баллистических глыб — отложенные пыхи пыли (лимит
      // DEBRIS_PUFF_MAX бережёт кольцевой буфер EjectaView от вытеснения частиц гриба).
      const landings = this.debrisView.emit(dir, yieldMt, seed, this.clock, carved.removedByMat);
      const puffs = Math.min(landings.length, DEBRIS_PUFF_MAX);
      for (let i = 0; i < puffs; i++) {
        const l = landings[i];
        if (l) this.ejectaView.emitPuff(l.dir, l.at, seed + i * 7 + 1);
      }
```

6. В `update()` после `this.ejectaView.setTime(this.clock);`:

```ts
    this.debrisView.setTime(this.clock);
```

- [ ] **Step 2: Полная проверка**

Run: `npm test`
Expected: PASS все тесты.

Run: `npm run build`
Expected: `tsc --noEmit` без ошибок, vite build успешен (предупреждение о чанке >500кб — известное, не блокер).

Run: `npm run lint`
Expected: чисто (или только ранее существовавшие замечания).

- [ ] **Step 3: Commit**

```bash
git add src/render/Scene.ts
git commit -m "feat(render): глыбы в Scene — разлёт при ударе, пыхи приземлений, reset чистит кольцо"
```

---

### Task 6: Банк памяти + мёрж

**Files:**
- Modify: `memory-bank/activeContext.md` (секция «Чем занимаемся прямо сейчас»)
- Modify: `memory-bank/progress.md` (статус + новый раздел фичи)

- [ ] **Step 1: Обновить банк памяти**

В `activeContext.md`: текущий фокус — «обломки-глыбы (этап 2) реализованы, ветка feat/debris», следующий — этап 3 (трещины + integrity в HUD). В `progress.md`: раздел «Обломки-глыбы (2026-07-14)» с чеклистом сделанного (removedByMat, debrisMath, DebrisView, emitPuff, интеграция, тесты) и пометкой, что визуальную приёмку смотрит юзер.

- [ ] **Step 2: Commit + мёрж в master**

```bash
git add memory-bank
git commit -m "docs(memory-bank): обломки-глыбы (этап 2) — реализовано"
git checkout master && git merge --no-ff feat/debris -m "Мёрж: обломки-глыбы (этап 2 реальной разрушаемости)"
npm test
```

Expected: тесты зелёные на master.

---

## Self-Review (выполнен)

- **Покрытие спеки:** §3.1 → Task 1; §3.2 → Tasks 2-3; §3.3 → Tasks 3 (emit) + 4 (пыхи) + 5 (Scene, reset); §3.4 → Task 2; §4 юнит-тесты → Tasks 1-2; ручная приёмка — за юзером. Пробелов нет.
- **Плейсхолдеры:** блок «ВАЖНО» в Task 3 — не отложенная работа, а обязательные правки при реализации (альтернативы даны кодом).
- **Согласованность типов:** `removedByMat` одинаков в Tasks 1/3/5; `DebrisLanding {dir, at}` в Tasks 3/5; `emitPuff(dir, spawn, seed)` в Tasks 4/5; сигнатура `emit` в Tasks 3/5 совпадает.
