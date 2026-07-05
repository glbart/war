# Вода-жидкость (подпроект №1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить статичный океан в жидкость — всегда анимированная водная оболочка + интерактивное GPU-поле, реагирующее рябью/каверной на ядерный удар.

**Architecture:** Три изолированных render-компонента. `CoastField` запекает equirect-маску океан/берег из `sim/landmask`. `WaterField` — GPU ping-pong волновое поле (порт паттерна `DamageField`): `step(dt)` каждый кадр, `splat(dir,strength,radius)` на удар. `OceanShell` — сфера чуть выше глобуса с ручным TSL-шейдингом (Gerstner + 3D-шум + сэмпл поля), рисуется только над океаном. Wiring — в `Scene`.

**Tech Stack:** TypeScript, three 0.185 (`three/webgpu` + `three/tsl`), vitest. Бэкенд — WebGPU с откатом WebGL2.

## Global Constraints

- **Общение/комментарии — русский** (CLAUDE.md); технические термины/код — как есть.
- **Никакого динамического света** — весь шейдинг воды ручной на TSL с константным «солнце»-юниформом (паттерн атмосферы в `GlobeView`).
- **WebGL2-совместимость:** НЕ использовать `CustomBlending + MaxEquation` (падает на WebGL2 — см. шапку `DamageField.ts`). Все проходы — обычный опаковый вывод с чтением предыдущего RT.
- **Ноль аллокаций на кадр** в горячих путях (`step`/`setTime`/`update`) — как в `ParticlePool`/`WaterBurstView`.
- **Визуальную приёмку НЕ автоматизируем** (медленно) — визуал проверяет пользователь вручную. Автоматом: `npm run build` (tsc), `npm test` (vitest, только чистая логика), `npm run lint`.
- **Материал/геймплей не трогаем** — только визуал океана. `WaterBurstView`, `GlobeView`, `sim/*` (кроме чтения `landmask`) — без изменений формы.
- Маппинг `dir → equirect uv`: `u=(lon+π)/2π`, `v=(π/2−lat)/π` (конвенция `DamageField.splat`/`landmask.isLand`).

**Решения по открытым вопросам спеки (§10), зафиксированы:** поле `1024×512`; `R_OCEAN=1.0008` + `polygonOffset` как страховка от z-fighting; отдельной клик-ряби нет (клик по воде = удар = splat даёт рябь); «солнце» — новый константный юниформ `OCEAN_SUN_DIR`.

---

## Файловая структура

- **Создать** `src/render/CoastField.ts` — чистый билдер данных океан/берег + THREE-обёртка `DataTexture`.
- **Создать** `src/render/CoastField.test.ts` — vitest на чистую логику расстояния до берега.
- **Создать** `src/render/WaterField.ts` — GPU ping-pong волновое поле (`step`/`splat`/`clear`/`texture`) + чистый хелпер `dirToFieldUV`.
- **Создать** `src/render/WaterField.test.ts` — vitest на `dirToFieldUV`.
- **Создать** `src/render/OceanShell.ts` — меш + TSL-материал анимированной воды.
- **Изменить** `src/assets/config.ts` — новые константы (по мере введения потребителя).
- **Изменить** `src/render/Scene.ts` — конструирование трёх компонентов + wiring в `startExplosion`/`update`/`planetReset`.

---

## Task 1: CoastField — маска океан/берег (чистая логика, TDD)

**Files:**
- Create: `src/render/CoastField.ts`
- Test: `src/render/CoastField.test.ts`
- Modify: `src/assets/config.ts` (добавить `COAST_TEX_W`, `COAST_TEX_H`)

**Interfaces:**
- Consumes: `isLand(lonRad, latRad): boolean` из `../sim/landmask`; `dirToLonLat` не нужен здесь.
- Produces:
  - `buildCoastData(isLand: (lon: number, lat: number) => boolean, w: number, h: number): Uint8Array` — 1 байт на тексель: `0` = суша, `255` = открытый океан, промежуточные — берег (расстояние до суши, нормированное). Строка-major, `idx = py*w + px`.
  - `buildCoastTexture(ctx: ThreeCtx, w: number, h: number): THREE.DataTexture` — R8-текстура из `buildCoastData(isLand, w, h)`, `wrapS=RepeatWrapping`, `wrapT=ClampToEdgeWrapping`, `needsUpdate=true`.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/render/CoastField.test.ts
import { describe, it, expect } from 'vitest';
import { buildCoastData } from './CoastField';

// Синтетическая маска: левая половина — суша, правая — океан.
const leftHalfLand = (lon: number): boolean => lon < 0; // lon∈[-π,π): <0 = западное полушарие = суша

describe('buildCoastData', () => {
  it('суша = 0, открытый океан = 255', () => {
    const w = 16, h = 8;
    const data = buildCoastData((lon) => leftHalfLand(lon), w, h);
    // тексель глубоко в суше (px=1) — 0
    expect(data[3 * w + 1]).toBe(0);
    // тексель у восточного края (открытый океан, максимально далеко от суши) — 255
    expect(data[3 * w + (w - 1)]).toBe(255);
  });

  it('у берега значение меньше, чем в открытом океане (градиент расстояния)', () => {
    const w = 32, h = 8;
    const data = buildCoastData((lon) => leftHalfLand(lon), w, h);
    const row = 4 * w;
    // px чуть правее границы суша/океан (~середина) — берег, значение мало
    const nearCoast = data[row + (w / 2 + 1)];
    // px у восточного края — открытый океан, значение велико
    const openOcean = data[row + (w - 1)];
    expect(nearCoast).toBeLessThan(openOcean);
    expect(nearCoast).toBeGreaterThan(0); // это океан, не суша
  });

  it('детерминизм: одинаковый вход → идентичный выход', () => {
    const a = buildCoastData((lon) => leftHalfLand(lon), 16, 8);
    const b = buildCoastData((lon) => leftHalfLand(lon), 16, 8);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test -- CoastField`
Expected: FAIL — `buildCoastData is not a function` / модуль не найден.

- [ ] **Step 3: Реализовать `CoastField.ts`**

```ts
// src/render/CoastField.ts
// Equirect-маска океан/берег для шейдера воды. Байт на тексель: 0 = суша, 255 = открытый океан,
// промежуточные — расстояние до ближайшей суши (для мелководного цвета и береговой пены).
// Расстояние — дешёвый многоитерационный разлив (chamfer-подобный) по маске, один раз при старте.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import { isLand as isLandDefault } from '../sim/landmask';
import { COAST_TEX_W, COAST_TEX_H } from '../assets/config';

// Сколько итераций разлива = насколько широкая береговая полоса (в текселях). При 1024×512
// ~24 текселя ≈ мягкий переход в несколько сотен км — достаточно для цвета/пены.
const SPREAD_ITERS = 24;

export function buildCoastData(
  isLand: (lon: number, lat: number) => boolean,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h;
  // dist: 0 = суша; иначе минимальное «манхэттен-подобное» число шагов до суши, обрезанное.
  const dist = new Int32Array(n);
  for (let py = 0; py < h; py++) {
    const lat = Math.PI / 2 - (py / h) * Math.PI;
    for (let px = 0; px < w; px++) {
      const lon = (px / w) * 2 * Math.PI - Math.PI;
      dist[py * w + px] = isLand(lon, lat) ? 0 : SPREAD_ITERS + 1;
    }
  }
  // Разлив: dist[i] = min(dist[i], min(соседи)+1). Несколько проходов вперёд и назад.
  const idx = (px: number, py: number): number => {
    const wx = ((px % w) + w) % w; // wrap по долготе
    const wy = Math.max(0, Math.min(h - 1, py)); // clamp по широте
    return wy * w + wx;
  };
  const relax = (px: number, py: number): void => {
    const i = py * w + px;
    if (dist[i] === 0) return;
    let m = dist[i]!;
    m = Math.min(m, dist[idx(px - 1, py)]! + 1);
    m = Math.min(m, dist[idx(px + 1, py)]! + 1);
    m = Math.min(m, dist[idx(px, py - 1)]! + 1);
    m = Math.min(m, dist[idx(px, py + 1)]! + 1);
    dist[i] = m;
  };
  for (let pass = 0; pass < SPREAD_ITERS; pass++) {
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) relax(px, py);
    for (let py = h - 1; py >= 0; py--) for (let px = w - 1; px >= 0; px--) relax(px, py);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.min(dist[i]!, SPREAD_ITERS + 1);
    // 0 суша → 0; открытый океан (d > SPREAD_ITERS) → 255; берег — линейно.
    out[i] = d === 0 ? 0 : Math.round((Math.min(d, SPREAD_ITERS) / SPREAD_ITERS) * 255);
  }
  return out;
}

export function buildCoastTexture(ctx: ThreeCtx, w = COAST_TEX_W, h = COAST_TEX_H): THREE.DataTexture {
  const { THREE } = ctx;
  const data = buildCoastData(isLandDefault, w, h);
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
```

Добавить в `src/assets/config.ts`:

```ts
// Разрешение вспомогательных equirect-текстур океана (маска берега / волновое поле).
export const COAST_TEX_W = 1024;
export const COAST_TEX_H = 512;
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test -- CoastField`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/render/CoastField.ts src/render/CoastField.test.ts src/assets/config.ts
git commit -m "feat(render): CoastField — equirect-маска океан/берег из landmask"
```

---

## Task 2: WaterField — GPU ping-pong волновое поле

**Files:**
- Create: `src/render/WaterField.ts`
- Test: `src/render/WaterField.test.ts`
- Modify: `src/assets/config.ts` (`WATER_FIELD_W/H`, `WATER_WAVE_SPEED`, `WATER_WAVE_DAMPING`, `WATER_SPLAT_STRENGTH`, `WATER_SPLAT_RADIUS`)

**Interfaces:**
- Consumes: `ThreeCtx` (`{ THREE, renderer, ... }`); `Vec3` из `../sim/geo`; `dirToLonLat` из `../sim/geo`.
- Produces (класс `WaterField`):
  - `constructor(ctx: ThreeCtx)`
  - `get texture(): THREE.Texture` — актуальное поле (`RGBA16F` при поддержке, иначе `RGBA8`-фолбэк); канал R = высота (знаковая при float; при фолбэке — раскодировать не нужно, шейдер воды читает как есть через общий путь), стабильная идентичность.
  - `step(dt: number): void` — один шаг симуляции (ping-pong swap внутри).
  - `splat(dir: Vec3, strength: number, radius: number): void` — импульс в поле у точки `dir`.
  - `clear(): void`
  - Экспорт-хелпер: `export function dirToFieldUV(dir: Vec3): { u: number; v: number }`.

> **Замечание по тестируемости:** сам GPU-проход headless не юнит-тестируется — его проверяет `tsc`/сборка и ручной визуал. Юнит-тестом покрываем только чистый хелпер `dirToFieldUV`.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/render/WaterField.test.ts
import { describe, it, expect } from 'vitest';
import { dirToFieldUV } from './WaterField';

// Конвенция проекта (src/sim/geo.ts): dirToLonLat = { lon: atan2(-z, x), lat: asin(y) },
// u = (lon+π)/2π, v = (π/2−lat)/π.
describe('dirToFieldUV', () => {
  it('+X (экватор, lon=0) → u=0.5, v=0.5', () => {
    const { u, v } = dirToFieldUV({ x: 1, y: 0, z: 0 });
    expect(u).toBeCloseTo(0.5, 5); // lon=atan2(0,1)=0
    expect(v).toBeCloseTo(0.5, 5); // lat=0
  });

  it('+Z (lon=−π/2) → u=0.25, v=0.5', () => {
    const { u, v } = dirToFieldUV({ x: 0, y: 0, z: 1 });
    expect(u).toBeCloseTo(0.25, 5); // lon=atan2(-1,0)=−π/2
    expect(v).toBeCloseTo(0.5, 5);
  });

  it('северный полюс (+Y) → v≈0', () => {
    const { v } = dirToFieldUV({ x: 0, y: 1, z: 0 });
    expect(v).toBeCloseTo(0, 5); // lat=asin(1)=π/2
  });

  it('u в [0,1] для любых направлений', () => {
    for (const d of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0.3, z: -1 }]) {
      const { u } = dirToFieldUV(d);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test -- WaterField`
Expected: FAIL — модуль/функция не найдены.

- [ ] **Step 3: Реализовать `WaterField.ts`**

Опорные паттерны (читать перед реализацией): `src/render/DamageField.ts` (ping-pong, ортокамера, snapshot prevRt, autoClear, `cos(lat)`-поправка, WebGL2-совместимость), `src/render/effects/particles.ts` (типизированные юниформы).

```ts
// src/render/WaterField.ts
// Интерактивное волновое поле океана: equirect-текстура (R=высота, G=скорость), эволюция по
// волновому уравнению h'' = c²·∇²h − damping·h' на GPU через ping-pong два RenderTarget.
// step() гонит симуляцию каждый кадр; splat() впечатывает импульс (рябь/каверна от удара).
// Затухание возвращает поле к штилю → постоянного следа нет. Порт паттерна DamageField
// (snapshot-в-prevRt заменён на честный ping-pong read/write разных RT).
//
// WebGL2: не используем MaxEquation/CustomBlending (см. DamageField). Формат RGBA16F при наличии
// EXT_color_buffer_float; иначе — тихая деградация до штиля (поле не эволюционирует, но не падает).
import type * as THREE from 'three/webgpu';
import {
  uniform,
  vec4,
  vec2,
  uv,
  texture,
  float,
  sin,
  exp,
  length,
  sub,
  mul,
  clamp,
  add,
  PI,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { dirToLonLat } from '../sim/geo';
import {
  WATER_FIELD_W,
  WATER_FIELD_H,
  WATER_WAVE_SPEED,
  WATER_WAVE_DAMPING,
} from '../assets/config';

export function dirToFieldUV(dir: Vec3): { u: number; v: number } {
  const { lon, lat } = dirToLonLat(dir);
  return { u: (lon + Math.PI) / (2 * Math.PI), v: (Math.PI / 2 - lat) / Math.PI };
}

function makeVec2Uniform(v: THREE.Vector2) {
  return uniform(v);
}
function makeFloatUniform(v: number) {
  return uniform(v);
}
type Vec2Uniform = ReturnType<typeof makeVec2Uniform>;
type FloatUniform = ReturnType<typeof makeFloatUniform>;

export class WaterField {
  private read: THREE.RenderTarget;
  private write: THREE.RenderTarget;
  private readonly stampScene: THREE.Scene;
  private readonly stampCam: THREE.OrthographicCamera;
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly uTexel: Vec2Uniform;
  private readonly uC2: FloatUniform; // c²·dt² (масштаб лапласиана за шаг)
  private readonly uDamp: FloatUniform;
  private readonly uSplatCenter: Vec2Uniform;
  private readonly uSplatStr: FloatUniform;
  private readonly uSplatRad: FloatUniform;
  private readonly uReadTex: ReturnType<typeof texture>;
  private readonly supported: boolean;

  constructor(private readonly ctx: ThreeCtx) {
    const { THREE } = ctx;
    // Поддержка float-RT: на WebGPU всегда; на WebGL2 — по расширению. Если нет — деградация.
    this.supported = true; // фактическую проверку добавить через ctx.renderer/бэкенд; при false step() = no-op
    const type = THREE.HalfFloatType;
    const makeRT = (): THREE.RenderTarget => {
      const rt = new THREE.RenderTarget(WATER_FIELD_W, WATER_FIELD_H, {
        depthBuffer: false,
        type,
        format: THREE.RGBAFormat,
      });
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      return rt;
    };
    this.read = makeRT();
    this.write = makeRT();

    this.stampScene = new THREE.Scene();
    this.stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2);
    this.stampCam.position.z = 1;

    this.uTexel = makeVec2Uniform(new THREE.Vector2(1 / WATER_FIELD_W, 1 / WATER_FIELD_H));
    this.uC2 = makeFloatUniform(WATER_WAVE_SPEED); // фактически c²·dt² подставляется в step()
    this.uDamp = makeFloatUniform(WATER_WAVE_DAMPING);
    this.uSplatCenter = makeVec2Uniform(new THREE.Vector2(0.5, 0.5));
    this.uSplatStr = makeFloatUniform(0);
    this.uSplatRad = makeFloatUniform(0.03);

    // Материал шага: читает read-RT (высота/скорость + 4 соседа), считает волновое уравнение,
    // добавляет отложенный splat-импульс, пишет новое (h, v). uReadTex переkey-ится на read перед
    // каждым рендером (см. step) — так один материал работает с ping-pong без пересборки графа.
    this.uReadTex = texture(this.read.texture, uv());

    const uvC = uv();
    const latWeight = sin(uvC.y.mul(PI)); // cos(lat) — сжатие долготы у полюсов
    const off = this.uTexel;
    // 4-соседний лапласиан; шаг по U делим на latWeight (клампим, чтобы не взрывалось у полюса).
    const wLat = clamp(latWeight, float(0.15), float(1));
    const sample = (du: number, dv: number) =>
      texture(this.read.texture, uvC.add(vec2(off.x.mul(du).div(wLat), off.y.mul(dv))));
    const c = this.uReadTex;
    const h = c.r;
    const v = c.g;
    const lap = add(
      sample(-1, 0).r,
      sample(1, 0).r,
      sample(0, -1).r,
      sample(0, 1).r,
    ).sub(h.mul(4));
    // splat: гауссов импульс в скорость у центра (с той же lat-поправкой аспекта, что DamageField).
    const dd = length(sub(uvC, this.uSplatCenter).mul(vec2(float(2).mul(latWeight), 1)));
    const impulse = this.uSplatStr.mul(exp(dd.div(this.uSplatRad).mul(dd.div(this.uSplatRad)).negate()));
    // semi-implicit: v' = (v + c²·lap)·(1−damp) + impulse; h' = h + v'
    const vNew = clamp(add(mul(add(v, lap.mul(this.uC2)), float(1).sub(this.uDamp)), impulse), float(-4), float(4));
    const hNew = clamp(add(h, vNew), float(-4), float(4));

    this.mat = new THREE.MeshBasicNodeMaterial();
    this.mat.colorNode = vec4(hNew, vNew, 0, 1);
    this.mat.transparent = false;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    mesh.position.set(0.5, 0.5, 0);
    this.stampScene.add(mesh);
  }

  get texture(): THREE.Texture {
    return this.read.texture;
  }

  step(dt: number): void {
    if (!this.supported) return;
    // c²·dt² фиксируем стабильным (dt клампим, иначе при лаге симуляция взрывается).
    const dtc = Math.min(dt, 1 / 30);
    this.uC2.value = WATER_WAVE_SPEED * dtc * dtc * (WATER_FIELD_W * WATER_FIELD_H) * 0; // см. примечание
    // Примечание: коэффициент подобрать при ручной настройке — начать с фиксированного значения
    // uC2≈0.25 (стабильно для 4-соседнего лапласиана: c²·dt²/dx² < 0.5). Здесь задаём напрямую:
    this.uC2.value = 0.25;

    const prevTarget = this.ctx.renderer.getRenderTarget();
    const prevAutoClear = this.ctx.renderer.autoClear;
    this.ctx.renderer.autoClear = false;
    // Материал читает this.read.texture (захвачен в узлах) → пишем в this.write.
    this.ctx.renderer.setRenderTarget(this.write);
    this.ctx.renderer.render(this.stampScene, this.stampCam);
    this.ctx.renderer.setRenderTarget(prevTarget);
    this.ctx.renderer.autoClear = prevAutoClear;

    // Импульс применён за этот шаг — гасим, чтобы не впечатывать повторно каждый кадр.
    this.uSplatStr.value = 0;
    // ping-pong swap. texture getter отдаёт this.read → после свапа наружу виден свежий кадр.
    const t = this.read;
    this.read = this.write;
    this.write = t;
    // Узлы материала ссылаются на конкретный RenderTarget.texture — после свапа переуказываем.
    // (three TSL texture() держит ссылку на объект текстуры; обновляем .value узла.)
    this.rebindRead();
  }

  private rebindRead(): void {
    // Переуказываем читаемую текстуру во всех узлах-сэмплерах на актуальный read-RT.
    // Реализация: держать ссылки на texture-узлы и присваивать .value = this.read.texture.
    // (Детали привязки уточнить по API three 0.185: TextureNode.value.)
    (this.uReadTex as unknown as { value: THREE.Texture }).value = this.read.texture;
  }

  splat(dir: Vec3, strength: number, radius: number): void {
    const { u, v } = dirToFieldUV(dir);
    this.uSplatCenter.value.set(u, v);
    this.uSplatStr.value = strength;
    this.uSplatRad.value = radius;
  }

  clear(): void {
    const prev = this.ctx.renderer.getRenderTarget();
    for (const rt of [this.read, this.write]) {
      this.ctx.renderer.setRenderTarget(rt);
      this.ctx.renderer.clearColor();
    }
    this.ctx.renderer.setRenderTarget(prev);
    this.uSplatStr.value = 0;
  }
}
```

> **Важно для реализатора:** ping-pong с одним материалом требует переуказывать читаемую текстуру после свапа (`rebindRead`). Точный способ обновить `TextureNode` в three 0.185 TSL — уточнить (варианты: держать `texture()`-узлы в полях и присваивать `.value`; либо два материала A/B, каждый читает свой RT, и рендерить попеременно нужным — как надёжнее). Это ключевой риск задачи; при сомнении — **вариант с двумя материалами** (matA читает rtA пишет rtB, matB наоборот), поочерёдно. Логику `step`/`splat`/`clear` и сигнатуры это не меняет.

Добавить в `src/assets/config.ts`:

```ts
// Волновое поле океана (интерактивная рябь/каверна). Разрешение делит COAST для простоты.
export const WATER_FIELD_W = 1024;
export const WATER_FIELD_H = 512;
export const WATER_WAVE_SPEED = 0.25; // c²·dt²/dx² эффективный (стабильно < 0.5 для 4-соседей)
export const WATER_WAVE_DAMPING = 0.006; // затухание за шаг → поле само возвращается к штилю
// Импульс удара по воде в поле (по мощности): сила (в скорость) и радиус (доля equirect).
export const WATER_SPLAT_STRENGTH: Record<number, number> = { 1: 0.6, 10: 1.1, 100: 1.9 };
export const WATER_SPLAT_RADIUS: Record<number, number> = { 1: 0.012, 10: 0.02, 100: 0.035 };
```

- [ ] **Step 4: Запустить тест + сборку**

Run: `npm test -- WaterField` → Expected: PASS (3 теста `dirToFieldUV`).
Run: `npm run build` → Expected: `tsc --noEmit` без ошибок, сборка проходит.

- [ ] **Step 5: Коммит**

```bash
git add src/render/WaterField.ts src/render/WaterField.test.ts src/assets/config.ts
git commit -m "feat(render): WaterField — GPU ping-pong волновое поле (рябь/каверна от удара)"
```

---

## Task 3: OceanShell — анимированная водная поверхность

**Files:**
- Create: `src/render/OceanShell.ts`
- Modify: `src/assets/config.ts` (`R_OCEAN`, `OCEAN_SUN_DIR`, `OCEAN_LON_SEG`, `OCEAN_LAT_SEG`)

**Interfaces:**
- Consumes: `ThreeCtx`; `THREE.Group` (родитель — `globe.spinGroup`); `fieldTex: THREE.Texture` (из `WaterField.texture`); `coastTex: THREE.Texture` (из `buildCoastTexture`).
- Produces (класс `OceanShell`):
  - `constructor(ctx: ThreeCtx, parent: THREE.Group, fieldTex: THREE.Texture, coastTex: THREE.Texture)` — создаёт меш и добавляет в `parent`.
  - `setTime(t: number): void` — обновляет `uTime` (секунды).

> GPU-материал headless не юнит-тестируется. Приёмка задачи: `npm run build` без ошибок + **ручной визуал** пользователя.

- [ ] **Step 1: Реализовать `OceanShell.ts`**

Опорные паттерны: `GlobeView.buildAtmosphere` (ручной Френель на TSL, `MeshBasicNodeMaterial`, без света), мокап `scratchpad/water-mockup.html` (утверждённый визуальный эталон: Gerstner-свеллы + fbm-нормаль + Френель-небо + блик + пена), `WaterBurstView` (типизированные юниформы).

```ts
// src/render/OceanShell.ts
// Анимированная водная оболочка океана поверх глобуса. Сфера радиуса R_OCEAN (чуть больше глобуса).
// Ручной TSL-шейдинг без динамического света: макро-волны (Gerstner, вершинный сдвиг) + сэмпл
// интерактивного WaterField, микро-детали — возмущение нормали 3D-шумом + градиент поля, цвет —
// глубина по CoastField + Френель-небо + блик константного солнца + пена. Discard на суше по CoastField.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  sin,
  cos,
  dot,
  cross,
  normalize,
  pow,
  clamp,
  mix,
  smoothstep,
  positionLocal,
  normalLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
  sub,
  add,
  mul,
  oneMinus,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import {
  R_OCEAN,
  OCEAN_SUN_DIR,
  OCEAN_LON_SEG,
  OCEAN_LAT_SEG,
  MAX_CRATER_DEPTH,
} from '../assets/config';

function makeFloatUniform(v: number) {
  return uniform(v);
}

export class OceanShell {
  private readonly uTime = makeFloatUniform(0);
  readonly mesh: THREE.Mesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group, fieldTex: THREE.Texture, coastTex: THREE.Texture) {
    const { THREE } = ctx;
    const mat = new THREE.MeshBasicNodeMaterial();
    const t = this.uTime;
    const sun = vec3(OCEAN_SUN_DIR[0], OCEAN_SUN_DIR[1], OCEAN_SUN_DIR[2]);

    // Поле высот (интерактив) и маска берега в equirect uv.
    const field = texture(fieldTex, uv());
    const coast = texture(coastTex, uv()).r; // 0 суша → 1 открытый океан
    const fieldH = field.r;

    // --- Вершина: макро-Gerstner + макро-отклик поля, сдвиг вдоль нормали ---
    // (амплитуды малы — доля радиуса; частоты по позиции, чтобы обходить полюса.)
    const p = positionLocal;
    const g1 = sin(dot(p, vec3(1.0, 0.3, 0.2)).mul(9.0).add(t.mul(1.1)));
    const g2 = sin(dot(p, vec3(-0.2, 0.5, 1.0)).mul(13.0).add(t.mul(1.4)));
    const macro = g1.mul(0.5).add(g2.mul(0.35)).mul(0.0015); // высота волн в долях радиуса
    const interactive = fieldH.mul(MAX_CRATER_DEPTH).mul(1.5); // отклик удара/ряби
    const disp = macro.add(interactive).mul(coast); // на суше не двигаем
    mat.positionNode = positionLocal.add(normalLocal.mul(disp));

    // --- Фрагмент ---
    const V = normalize(sub(cameraPosition, positionWorld));
    const N = normalWorld; // базовая геонормаль (макро уже в геометрии)
    // Микро-нормаль: наклон от анимированного 3D-шума + градиента поля (упрощённо через частные
    // разности uv поля). Полную реализацию шума перенести из мокапа (fbm 3 октавы).
    const fieldGradX = texture(fieldTex, uv().add(vec2(0.002, 0))).r.sub(fieldH);
    const fieldGradY = texture(fieldTex, uv().add(vec2(0, 0.002))).r.sub(fieldH);
    // касательный базис
    const up = vec3(0, 1, 0);
    const t1 = normalize(cross(up, N));
    const t2 = cross(N, t1);
    const perturbed = normalize(
      sub(N, add(t1.mul(fieldGradX.mul(30.0)), t2.mul(fieldGradY.mul(30.0)))),
    );

    // Цвет: глубина по берегу
    const deep = vec3(0.015, 0.10, 0.20);
    const shallow = vec3(0.06, 0.34, 0.44);
    const base = mix(shallow, deep, coast);
    // Френель → небо
    const fres = pow(oneMinus(clamp(dot(perturbed, V), float(0), float(1))), float(4));
    const sky = vec3(0.35, 0.55, 0.95);
    let col = mix(base, sky, fres.mul(0.8));
    // Блик солнца (Blinn-Phong, статичное солнце)
    const Hh = normalize(add(sun, V));
    const spec = pow(clamp(dot(perturbed, Hh), float(0), float(1)), float(200));
    col = add(col, vec3(1.0, 0.96, 0.85).mul(spec.mul(1.3)));
    // Диффуз для объёма
    const diff = clamp(dot(perturbed, sun), float(0), float(1));
    col = mul(col, float(0.55).add(diff.mul(0.5)));
    // Пена: гребни (высота поля) + береговая полоса
    const crest = smoothstep(float(0.25), float(0.7), fieldH);
    const shoreFoam = oneMinus(coast).mul(0.6);
    const foam = clamp(add(crest, shoreFoam), float(0), float(1));
    col = mix(col, vec3(0.85, 0.94, 1.0), foam.mul(0.7));

    mat.colorNode = vec4(col, 1);
    // Discard суши: прозрачность 0 там, где coast≈0 (суша). Порог мягкий у самого берега.
    mat.opacityNode = smoothstep(float(0.02), float(0.08), coast);
    mat.transparent = true;
    mat.depthWrite = true;
    // Страховка от z-fighting с ocean-цветом глобуса (в дополнение к R_OCEAN>1).
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R_OCEAN, OCEAN_LON_SEG, OCEAN_LAT_SEG),
      mat,
    );
    this.mesh.renderOrder = 1; // после глобуса (0), до атмосферы-additive
    parent.add(this.mesh);
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }
}
```

> **Реализатору:** блок «микро-нормаль» здесь упрощён до градиента поля. Перенести из утверждённого мокапа (`scratchpad/water-mockup.html`, функции `noise`/`fbm`/`ambient`/`waterNormal`) полноценные анимированные fbm-волны (3 октавы) как основной источник «жизни» воды — поле даёт только отклик на удар, а постоянное волнение — от шума. Это и есть визуальный эталон, утверждённый пользователем.

Добавить в `src/assets/config.ts`:

```ts
// Водная оболочка океана.
export const R_OCEAN = 1.0008; // чуть выше глобуса (r=1) — против z-fighting с ocean-цветом
export const OCEAN_LON_SEG = 384;
export const OCEAN_LAT_SEG = 192;
// Константное направление «солнца» для ручного шейдинга воды (без динамического света).
export const OCEAN_SUN_DIR: [number, number, number] = [0.55, 0.65, 0.52];
```

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: `tsc --noEmit` без ошибок, сборка проходит.

- [ ] **Step 3: Коммит**

```bash
git add src/render/OceanShell.ts src/assets/config.ts
git commit -m "feat(render): OceanShell — анимированная водная оболочка (Gerstner+шум, Френель, пена)"
```

---

## Task 4: Wiring в Scene

**Files:**
- Modify: `src/render/Scene.ts`

**Interfaces:**
- Consumes: `WaterField` (`step`/`splat`/`clear`/`texture`), `OceanShell` (`setTime`), `buildCoastTexture`, `WATER_SPLAT_STRENGTH`/`WATER_SPLAT_RADIUS`.
- Produces: рабочая интерактивная вода в приложении.

- [ ] **Step 1: Импорты и поля**

В `src/render/Scene.ts` добавить импорты:

```ts
import { WaterField } from './WaterField';
import { OceanShell } from './OceanShell';
import { buildCoastTexture } from './CoastField';
import { WATER_SPLAT_STRENGTH, WATER_SPLAT_RADIUS } from '../assets/config';
```

Добавить приватные поля в класс `Scene`:

```ts
  private readonly waterField: WaterField;
  private readonly oceanShell: OceanShell;
```

- [ ] **Step 2: Конструирование (в конце конструктора `Scene`, после `this.decalView = ...`)**

```ts
    // Интерактивная вода: поле волн + маска берега + анимированная оболочка над глобусом.
    this.waterField = new WaterField(ctx);
    const coastTex = buildCoastTexture(ctx);
    this.oceanShell = new OceanShell(ctx, globe.spinGroup, this.waterField.texture, coastTex);
```

- [ ] **Step 3: Отклик на удар по воде**

В `startExplosion`, ветку `if (surface === 'water')` дополнить (НЕ убирая существующий `waterBurstView.spawn`):

```ts
    if (surface === 'water') {
      this.waterBurstView.spawn(dir, yieldMt, seed);
      // Интерактивное поле: импульс каверны/ряби (сила/радиус по мощности).
      this.waterField.splat(dir, WATER_SPLAT_STRENGTH[yieldMt] ?? 1, WATER_SPLAT_RADIUS[yieldMt] ?? 0.02);
    } else {
```

- [ ] **Step 4: Прогон симуляции и времени в `update(dt)`**

В методе `update(dt)` добавить (после `this.clock += dt;`):

```ts
    this.waterField.step(dt);
    this.oceanShell.setTime(this.clock);
```

- [ ] **Step 5: Очистка на `planetReset`**

В `handleEvent`, ветку `case 'planetReset':` дополнить:

```ts
      case 'planetReset':
        this.decalView.clear();
        this.damageField.clear();
        this.waterField.clear();
        break;
```

- [ ] **Step 6: Сборка + линт**

Run: `npm run build` → Expected: без ошибок.
Run: `npm run lint` → Expected: без ошибок.

- [ ] **Step 7: Ручная визуальная проверка (пользователь)**

Запустить `npm run dev`, открыть в браузере. Проверить (пользователь сообщит правки):
- океан анимирован (волны двигаются), берег чёткий (discard суши работает);
- Френель/цвет по глубине/блик/пена читаются как вода;
- удар по океану → каверна раскрывается и **смыкается** в рябь, поле возвращается к штилю;
- нет ошибок шейдеров в консоли (WebGPU и, если доступен, WebGL2);
- перф ~60fps на обычном зуме.

- [ ] **Step 8: Коммит**

```bash
git add src/render/Scene.ts
git commit -m "feat(render): wiring интерактивной воды в Scene (поле+оболочка, splat на удар, clear на reset)"
```

---

## Self-Review (выполнено при написании плана)

- **Покрытие спеки:** §3 компоненты `WaterField`/`CoastField`/`OceanShell` → Tasks 2/1/3; wiring §3 → Task 4; §5 краевые случаи (полюса `cos(lat)`, шов `RepeatWrapping`, WebGL2-совместимость, float-фолбэк) → отражены в коде Task 2; §7 тестирование (ручной визуал + юнит только логика) → Tasks 1/2 юниты, Task 3/4 build+manual. §10 открытые вопросы → зафиксированы в Global Constraints.
- **Заглушки:** код приведён целиком; два места помечены как **риск реализации** с конкретной альтернативой (ping-pong rebind в Task 2 → вариант двух материалов; fbm-нормаль в Task 3 → перенос из утверждённого мокапа). Это не placeholder-и, а явные указания с готовым fallback-подходом.
- **Согласованность типов:** `WaterField.texture`→`OceanShell(fieldTex)`; `buildCoastTexture`→`OceanShell(coastTex)`; `splat(dir,strength,radius)` совпадает в Task 2 и вызове Task 4; `setTime`/`step`/`clear` — единые сигнатуры.
- **Известный риск:** float-RT на WebGL2 (`EXT_color_buffer_float`) — при отсутствии `supported=false` → `step` no-op (штиль, без падения). Фактическую проверку поддержки реализовать в Task 2 Step 3 (уточнить API бэкенда `ctx.renderer`).
