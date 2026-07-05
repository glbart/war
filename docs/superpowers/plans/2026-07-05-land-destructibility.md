# Физическая разрушаемость суши (2A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Заменить плоское «чёрное пятно» удара по суше на физически читаемый кратер — чаша + приподнятый вал + эжекта + зоны материала + баллистические частицы выброса.

**Architecture:** Расширяем существующее GPU displacement-поле. `DamageField` запекает богатый профиль (чаша R + вал/эжекта A + широкая гарь-интенсивность G). `GlobeView` вдавливает/вздымает вершину и красит радиальные зоны материала + микрорельеф нормали. Новый `EjectaView` бросает баллистические частицы грунта (паттерн `ParticlePool`, но парабола взлёт+падение). Wiring в `Scene`.

**Tech Stack:** TypeScript, three 0.185 (`three/webgpu` + `three/tsl`), vitest. WebGPU + откат WebGL2.

## Global Constraints

- Комментарии/имена — **русский**; технические термины/код — как есть.
- **Никакого динамического света** — рельеф читается статичным светом сцены; шейдинг как в текущем `GlobeView`.
- **WebGL2-совместимость:** НЕ использовать `CustomBlending + MaxEquation` (падает на WebGL2). Слияние кратеров — по-канальный `max` через чтение prev-RT (уже реализовано в `DamageField`, шапка файла). Новый канал A — та же механика.
- **Ноль аллокаций на кадр** в горячих путях (`EjectaView.setTime`, `Scene.update`).
- **Маппинг equirect uv:** `u=(lon+π)/2π`, `v=(π/2−lat)/π`; `cos(lat)`-поправка аспекта у полюсов (как в `DamageField`).
- **Только визуал** — sim/геймплей/жертвы НЕ трогаем. `WaterBurstView`, вода (подпроект №1), LOD (2B) — не трогаем.
- **Визуальную приёмку НЕ автоматизируем** — вид/перф проверит пользователь. Автоматом: `npm test` (чистая логика), `npm run build` (tsc), `npm run lint`.
- Каналы `DamageField` после этой работы: **R**=глубина чаши (вниз), **G**=гарь/материал-интенсивность (широкий градиент), **B**=оплавление/полынья (лёд, без изменений), **A**=вал+эжекта (вверх). Задокументировать в шапке файла.

**Автономные решения (открытые вопросы спеки §11):** вал кодируем в канал **A** (не ломаем R-путь); эжекта — **отдельный `EjectaView`** (не трогаем рабочий меш гриба); лёд — вал/эжекта **как суша** (материал-зоны иные, но профиль тот же — минимум ветвлений); микродеталь нормали — через возмущение в `colorNode`-соседстве, реализация нормали уточняется по API (предпочесть явный `normalNode`, если доступен, иначе усиление bump).

---

## Файловая структура

- **Изменить** `src/render/DamageField.ts` — профиль штампа (вал A + эжекта + широкая гарь), док каналов.
- **Создать** `src/render/effects/craterProfile.ts` — чистые функции профиля (глубина/вал/эжекта/гарь по нормированному радиусу) — источник истины формы, переиспользуется в тесте-оракуле.
- **Создать** `test/render/craterProfile.test.ts` — vitest на форму профиля.
- **Изменить** `src/render/GlobeView.ts` — `positionNode` (вал по A), `colorNode` (зоны материала вместо чёрной гари), микродеталь нормали в damaged-зоне.
- **Создать** `src/render/EjectaView.ts` — баллистические частицы выброса.
- **Создать** `test/render/ejecta.test.ts` — vitest на баллистическую кривую (CPU-оракул) + детерминизм emit-параметров.
- **Изменить** `src/render/Scene.ts` — wiring `EjectaView`.
- **Изменить** `src/assets/config.ts` — константы (см. задачи).

---

## Task 1: DamageField — профиль кратера (вал + эжекта + широкая гарь)

**Files:**
- Create: `src/render/effects/craterProfile.ts`
- Test: `test/render/craterProfile.test.ts`
- Modify: `src/render/DamageField.ts`
- Modify: `src/assets/config.ts` (`CRATER_RIM_FRAC`, `CRATER_RIM_WIDTH_FRAC`, `CRATER_SCORCH_FRAC`, `CRATER_EJECTA_FRAC`)

**Interfaces:**
- Produces (чистые функции, `craterProfile.ts`):
  - `craterProfile(dNorm: number): { depth: number; rim: number; ejecta: number; scorch: number }` — профиль по нормированному радиальному расстоянию `dNorm = d / uRadius` (0 в центре, 1 на краю чаши, >1 снаружи). Все выходы в [0,1].
    - `depth` = чаша: 1 в центре → 0 к `dNorm=1` (гладко).
    - `rim` = кольцевой бугор (гаусс) с центром на `dNorm≈CRATER_RIM_FRAC` (>1), спад по `CRATER_RIM_WIDTH_FRAC`.
    - `ejecta` = наслоение выброса снаружи вала: 1 у вала → 0 к `dNorm≈CRATER_EJECTA_FRAC` (спад к периферии).
    - `scorch` = широкий гарь-градиент: 1 в центре → 0 к `dNorm≈CRATER_SCORCH_FRAC` (шире чаши, мягкое затухание — НЕ резкий чёрный край).
- Эти же формулы переносятся в TSL-штамп `DamageField` (та же форма, аргумент — `d/uRadius`).

- [ ] **Step 1: Написать падающий тест**

```ts
// test/render/craterProfile.test.ts
import { describe, it, expect } from 'vitest';
import { craterProfile } from '../../src/render/effects/craterProfile';

describe('craterProfile', () => {
  it('чаша: глубина максимальна в центре, спадает к краю', () => {
    expect(craterProfile(0).depth).toBeCloseTo(1, 2);
    expect(craterProfile(1).depth).toBeLessThan(0.1);
    expect(craterProfile(0).depth).toBeGreaterThan(craterProfile(0.5).depth);
  });

  it('вал: приподнят ЗА краем чаши (dNorm>1), в центре вала нет', () => {
    expect(craterProfile(0).rim).toBeLessThan(0.1);
    // где-то в районе вала rim заметно выше нуля
    const around = [1.1, 1.2, 1.3, 1.4].map((d) => craterProfile(d).rim);
    expect(Math.max(...around)).toBeGreaterThan(0.5);
  });

  it('эжекта: спадает к периферии', () => {
    const near = craterProfile(1.3).ejecta;
    const far = craterProfile(2.5).ejecta;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan(0.15);
  });

  it('гарь: широкий мягкий градиент, не обрывается на краю чаши', () => {
    // на краю чаши гарь ещё заметна (не 0), т.е. шире воронки
    expect(craterProfile(1).scorch).toBeGreaterThan(0.2);
    expect(craterProfile(0).scorch).toBeGreaterThan(craterProfile(1.5).scorch);
  });

  it('все выходы в [0,1]', () => {
    for (let d = 0; d <= 3; d += 0.1) {
      const p = craterProfile(d);
      for (const v of [p.depth, p.rim, p.ejecta, p.scorch]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- craterProfile` → Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `craterProfile.ts` + константы**

```ts
// src/render/effects/craterProfile.ts
// Чистый радиальный профиль кратера (источник истины формы для TSL-штампа DamageField и тестов).
// Аргумент dNorm = d / uRadius: 0 — центр, 1 — край чаши, >1 — снаружи (вал/эжекта).
import {
  CRATER_RIM_FRAC,
  CRATER_RIM_WIDTH_FRAC,
  CRATER_EJECTA_FRAC,
  CRATER_SCORCH_FRAC,
} from '../../assets/config';

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function craterProfile(dNorm: number): {
  depth: number;
  rim: number;
  ejecta: number;
  scorch: number;
} {
  // Чаша: 1 в центре → 0 к краю (dNorm=1).
  const depth = smoothstep(1, 0, dNorm);
  // Вал: гаусс с центром CRATER_RIM_FRAC, шириной CRATER_RIM_WIDTH_FRAC.
  const rimX = (dNorm - CRATER_RIM_FRAC) / CRATER_RIM_WIDTH_FRAC;
  const rim = Math.exp(-rimX * rimX);
  // Эжекта: от вала спадает к CRATER_EJECTA_FRAC.
  const ejecta = smoothstep(CRATER_EJECTA_FRAC, CRATER_RIM_FRAC, dNorm);
  // Гарь: широкий мягкий градиент до CRATER_SCORCH_FRAC.
  const scorch = smoothstep(CRATER_SCORCH_FRAC, 0, dNorm);
  return { depth, rim, ejecta, scorch };
}
```

Добавить в `src/assets/config.ts`:

```ts
// Профиль кратера суши (в долях радиуса чаши uRadius): где вал, его ширина, докуда эжекта/гарь.
export const CRATER_RIM_FRAC = 1.18; // центр кольца-вала (снаружи чаши)
export const CRATER_RIM_WIDTH_FRAC = 0.28; // полуширина гаусса вала
export const CRATER_EJECTA_FRAC = 2.6; // докуда стелется выброс
export const CRATER_SCORCH_FRAC = 2.0; // радиус мягкого гарь-градиента (шире чаши)
export const CRATER_RIM_HEIGHT = 0.006; // высота вала над поверхностью (доля радиуса планеты)
```

- [ ] **Step 4: Тест зелёный**

Run: `npm test -- craterProfile` → Expected: PASS (5 тестов).

- [ ] **Step 5: Перенести профиль в TSL-штамп `DamageField`**

Опора — текущий `src/render/DamageField.ts` (чаша `bowl`, `latWeight`, `d`, `max(prevSample, stamp)`).
Изменения в построении `stamp` (метод-конструктор материала штампа):
- `dNorm = d.div(this.uRadius)` (нормировать имеющееся `d` на `uRadius`).
- По формулам `craterProfile` на TSL: `depth = smoothstep(1,0,dNorm)`, `rim = exp(-rimX*rimX)`,
  `ejecta = smoothstep(EJECTA,RIM,dNorm)`, `scorch = smoothstep(SCORCH,0,dNorm)` (константы из config).
- Каналы: `R = depth`, `G = clamp(scorch, 0, 1)` (широкая гарь вместо `bowl*0.8`),
  `B = clamp(depth.mul(uKind),0,1)` (лёд как было), `A = clamp(rim.add(ejecta.mul(0.35)), 0, 1)`
  (вверх: вал + лёгкое наслоение эжекты).
- `stamp = vec4(R, G, B, A)`; слияние `max(prevSample, stamp)` — как есть (теперь включает A).
- Обновить шапку файла: задокументировать R/G/B/A.
- Убедиться, что prev-RT сэмплится с A (RGBA), формат RT уже RGBA (`UnsignedByteType`).

- [ ] **Step 6: Сборка/линт**

Run: `npm run build` → без ошибок. `npm run lint` → чисто. `npm test` → все зелёные.

- [ ] **Step 7: Коммит**

```bash
git add src/render/effects/craterProfile.ts test/render/craterProfile.test.ts src/render/DamageField.ts src/assets/config.ts
git commit -m "feat(render): DamageField — профиль кратера (вал+эжекта канал A, широкая гарь G)"
```

---

## Task 2: GlobeView — вал, зоны материала, микрорельеф

**Files:**
- Modify: `src/render/GlobeView.ts`
- Modify: `src/assets/config.ts` (`CRATER_MATERIAL_COLORS`, `CRATER_DETAIL_OCTAVES`, `CRATER_DETAIL_STRENGTH`)

**Interfaces:**
- Consumes: поле урона `damageTex` (R=глубина, G=гарь-градиент, B=оплавление, A=вал+эжекта); `MAX_CRATER_DEPTH`, `CRATER_RIM_HEIGHT`.
- Produces: физический вид кратера на глобусе.

> GPU-материал headless НЕ тестируется. Приёмка: `npm run build` + `npm run lint` + ручной визуал пользователя (Task 4/финал).

- [ ] **Step 1: `positionNode` — чаша вниз + вал вверх**

В `src/render/GlobeView.ts`, где сейчас:
```ts
earthMaterial.positionNode = positionLocal.sub(
  normalLocal.mul(depth.mul(float(MAX_CRATER_DEPTH))),
);
```
заменить на (добавить вздутие вала по каналу A):
```ts
const rimUp = dmg.a.mul(float(CRATER_RIM_HEIGHT));
earthMaterial.positionNode = positionLocal
  .sub(normalLocal.mul(depth.mul(float(MAX_CRATER_DEPTH))))
  .add(normalLocal.mul(rimUp));
```
(`dmg` уже сэмплится: `const dmg = texture(damageTex, uv())`. Импортировать `CRATER_RIM_HEIGHT`.)

- [ ] **Step 2: `colorNode` — радиальные зоны материала вместо чёрной гари**

Заменить текущий одноцветный `charred` (`mix(base, vec3(0.06,0.05,0.05), dmg.g)`) на послойную смесь по (R=depth, A=rim/ejecta, G=scorch). Пример структуры (цвета из config, подобрать в визуале):
```ts
const base = texture(biomeTex, uv()).rgb;
// Зоны (по возрастанию «жёсткости» к центру):
// 1) широкая гарь — мягкое потемнение биома (градиент, не слэб):
const scorched = mix(base, vec3(0.12, 0.10, 0.08), clamp(dmg.g.mul(0.8), 0, 1));
// 2) выброс/пыль на кольце вала (A) — присыпка светлее биома:
const dusted = mix(scorched, vec3(0.42, 0.38, 0.32), clamp(dmg.a.mul(0.6), 0, 1));
// 3) обнажённая порода на склоне чаши (средний depth):
const rockMask = clamp(dmg.r.mul(1.6), 0, 1).mul(oneMinus(smoothstep(0.7, 1.0, dmg.r)));
const rocky = mix(dusted, vec3(0.28, 0.24, 0.21), rockMask);
// 4) оплавленное стекло в центре (высокий depth) — тёмное, низкосатурированное:
const glass = mix(rocky, vec3(0.10, 0.09, 0.11), smoothstep(0.7, 1.0, dmg.r));
// лёд-полынья (B) поверх — как было:
const iceRim = smoothstep(0.15, 0.4, dmg.b);
const openWater = smoothstep(0.45, 0.75, dmg.b);
const withIce = mix(glass, vec3(0.7, 0.78, 0.85), iceRim);
const molten = mix(withIce, vec3(0.05, 0.12, 0.2), openWater);
earthMaterial.colorNode = molten;
```
Ключ: гарь теперь **градиент** (`dmg.g` — широкий scorch), центр — стекло/порода, а не единый near-black.

- [ ] **Step 3: Микрорельеф нормали в damaged-зоне**

Добавить процедурный шум-возмущение нормали, силой ∝ (R+A), чтобы вал/стенки ловили статичный свет.
Реализация — по API three 0.185:
- Предпочтительно `earthMaterial.normalNode` с возмущением от 2–3-октавного шума по `positionLocal`,
  маскированным `clamp(dmg.r.add(dmg.a),0,1).mul(CRATER_DETAIL_STRENGTH)`.
- Если явный `normalNode`-путь окажется сложным/несовместимым — усилить `bumpMap`-вклад локально или
  добавить деталь через уже используемый bump (отметить выбранный путь в отчёте).
Референс шума — `src/render/OceanShell.ts` (перенесённые `hash/noise/fbm` на TSL Fn) и `MaterialGlobe`.
Константы: `CRATER_DETAIL_OCTAVES=3`, `CRATER_DETAIL_STRENGTH` (подбор в визуале).

- [ ] **Step 4: Сборка/линт**

Run: `npm run build` → без ошибок. `npm run lint` → чисто.

- [ ] **Step 5: Коммит**

```bash
git add src/render/GlobeView.ts src/assets/config.ts
git commit -m "feat(render): GlobeView — вал кратера + зоны материала + микрорельеф вместо чёрной гари"
```

---

## Task 3: EjectaView — баллистические частицы выброса

**Files:**
- Create: `src/render/EjectaView.ts`
- Test: `test/render/ejecta.test.ts`
- Modify: `src/assets/config.ts` (`EJECTA_COUNT_BY_YIELD`, `EJECTA_GRAVITY`, `EJECTA_SPEED_BY_YIELD`)

**Interfaces:**
- Consumes: `ThreeCtx`, `THREE.Group` (родитель `globe.spinGroup`), `Vec3`.
- Produces (класс `EjectaView`):
  - `constructor(ctx: ThreeCtx, parent: THREE.Group)`
  - `emit(dir: Vec3, yieldMt: number, seed: number, now: number): void` — бросок пачки баллистических частиц грунта из точки `dir`.
  - `setTime(t: number): void`
  - Экспорт-хелпер для теста: `export function ballisticHeight(v0: number, g: number, tau: number): number` — высота `v0·tau − ½·g·tau²` (клампится к ≥0 у поверхности).

**Опора:** `src/render/effects/particles.ts` — структура `ParticleMesh` (инстанс aA/aB/aC, кольцевой буфер, `SpriteNodeMaterial`, `uTime`, ноль аллокаций/кадр). Отличие: **кривая высоты — баллистическая** (взлёт+падение), а не монотонный подъём; цвет — грунт/пыль/обломки.

- [ ] **Step 1: Написать падающий тест**

```ts
// test/render/ejecta.test.ts
import { describe, it, expect } from 'vitest';
import { ballisticHeight } from '../../src/render/EjectaView';

describe('ballisticHeight', () => {
  it('стартует у поверхности, поднимается, падает обратно к нулю', () => {
    const v0 = 1, g = 2;
    expect(ballisticHeight(v0, g, 0)).toBeCloseTo(0, 5);
    const peakT = v0 / g; // вершина параболы
    expect(ballisticHeight(v0, g, peakT)).toBeGreaterThan(0);
    // симметрично: к моменту 2·peakT вернулась к 0
    expect(ballisticHeight(v0, g, 2 * peakT)).toBeCloseTo(0, 5);
  });

  it('не уходит ниже нуля (клампится у поверхности)', () => {
    expect(ballisticHeight(1, 2, 5)).toBeGreaterThanOrEqual(0);
  });

  it('вершина выше при большей начальной скорости', () => {
    const g = 2;
    const peak = (v: number) => ballisticHeight(v, g, v / g);
    expect(peak(2)).toBeGreaterThan(peak(1));
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- ejecta` → Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `EjectaView.ts`**

Структуру инстанс-меша/атрибутов/кольцевого буфера портировать из `particles.ts` (`ParticleMesh`),
адаптировав движение под баллистику. Ключевой чистый хелпер + класс:

```ts
// src/render/EjectaView.ts
// Баллистические частицы выброса грунта при ударе по суше: спавн из эпицентра, разлёт наружу+вверх,
// падение обратно под «гравитацией» (парабола), гаснут у поверхности. Инстанс-спрайты, движение в
// TSL из атрибутов, кольцевой буфер, один uTime, ноль аллокаций/кадр — паттерн ParticlePool.
// Цвет — грунт/пыль (бурый→серый), доля тёмных обломков.
export function ballisticHeight(v0: number, g: number, tau: number): number {
  return Math.max(0, v0 * tau - 0.5 * g * tau * tau);
}
// ... класс EjectaView: конструктор строит InstancedMesh со SpriteNodeMaterial; TSL-граф считает
// pos = surface*(1+h) + tangent*radial, где h — баллистическая высота из атрибутов (v0,g,spawn),
// radial растёт со временем; alpha гаснет к концу жизни/у поверхности. emit() пишет пачку в буфер
// (детерминированный RNG от seed, как в ParticlePool.emit), setTime обновляет uTime.
```
Полную реализацию инстанс-меша брать из `particles.ts` как образец (не дублировать бездумно — вынести
общее при очевидной выгоде, иначе самостоятельный компактный класс). Баллистическую высоту в TSL
выразить теми же узлами (`mul/sub`), что и `ballisticHeight`.

Константы в `config.ts`:
```ts
// Баллистический выброс грунта при ударе по суше.
export const EJECTA_COUNT_BY_YIELD: Record<number, number> = { 1: 40, 10: 80, 100: 140 };
export const EJECTA_SPEED_BY_YIELD: Record<number, number> = { 1: 0.12, 10: 0.2, 100: 0.32 };
export const EJECTA_GRAVITY = 0.6; // «сила тяжести» параболы (единицы радиуса/с²)
```

- [ ] **Step 4: Тест зелёный + сборка**

Run: `npm test -- ejecta` → PASS (3 теста). `npm run build` → без ошибок. `npm run lint` → чисто.

- [ ] **Step 5: Коммит**

```bash
git add src/render/EjectaView.ts test/render/ejecta.test.ts src/assets/config.ts
git commit -m "feat(render): EjectaView — баллистические частицы выброса грунта"
```

---

## Task 4: Wiring в Scene

**Files:**
- Modify: `src/render/Scene.ts`

**Interfaces:**
- Consumes: `EjectaView` (`emit`/`setTime`), `EJECTA_*` (косвенно, внутри EjectaView).
- Produces: рабочий физический удар по суше.

- [ ] **Step 1: Импорт и поле**

В `src/render/Scene.ts`: `import { EjectaView } from './EjectaView';`
Поле: `private readonly ejectaView: EjectaView;`

- [ ] **Step 2: Конструирование**

В конструкторе (рядом с `this.particlePool = ...`): `this.ejectaView = new EjectaView(ctx, globe.spinGroup);`

- [ ] **Step 3: Emit на удар по суше/льду**

В `startExplosion`, ветка `else` (суша/лёд), добавить рядом с `particlePool.emit`:
```ts
      this.ejectaView.emit(dir, yieldMt, seed, this.clock);
```
(НЕ трогать water-ветку и остальные вызовы.)

- [ ] **Step 4: Время в `update`**

В `update(dt)` (рядом с `this.particlePool.setTime(this.clock)`): `this.ejectaView.setTime(this.clock);`

- [ ] **Step 5: Сборка/линт**

Run: `npm run build` → без ошибок. `npm run lint` → чисто.

- [ ] **Step 6: Ручной визуал (пользователь, позже)** — кратер с валом/эжектой/зонами материала, микрорельеф на свету, баллистические частицы грунта, накопление, нет «чёрного пятна», перф.

- [ ] **Step 7: Коммит**

```bash
git add src/render/Scene.ts
git commit -m "feat(render): wiring EjectaView в Scene (выброс грунта на удар по суше)"
```

---

## Self-Review (при написании)

- **Покрытие спеки:** §4 компоненты → Tasks 1(DamageField+профиль)/2(GlobeView)/3(EjectaView)/4(wiring); §3 каналы R/G/B/A → Task 1; зоны материала/вал/микрорельеф → Task 2; баллистика → Task 3; §6 краевые (WebGL2 max, полюса, пул) → в коде Task 1/3; §8 тесты (профиль-оракул + баллистика) → Tasks 1/3.
- **Заглушки:** формулы профиля и баллистики даны целиком (чистые функции + тесты); TSL-микродеталь нормали и полный инстанс-меш эжекты помечены «перенести из существующего образца» (`OceanShell`/`particles.ts`) — это указания с рабочим прототипом, не placeholder.
- **Согласованность:** каналы R/G/B/A едины (Task1 пишет → Task2 читает); `ballisticHeight` — общий контракт Task3 (тест+TSL); `emit(dir,yield,seed,now)` совпадает с сигнатурой `ParticlePool.emit` и вызовом Task4.
- **Риск:** микродеталь нормали через `normalNode` в three 0.185 — если API неудобен, fallback на bump (отмечено в Task 2 Step 3). Реализатор выбирает по факту, отмечает в отчёте.
