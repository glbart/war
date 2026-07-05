# Детализация поверхности на зуме (2B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** При приближении камеры суша обретает процедурную детализацию (мелкая вариация цвета + микрорельеф нормали), нарастающую по дистанции — «крупные пиксели/мыло» на зуме заменяются хрустящей деталью, далёкий вид не меняется.

**Architecture:** Общий шум выносим в `render/noise.ts` (закрывает дубль OceanShell↔GlobeView). В `GlobeView` добавляем detail-слой: сила по дистанции камеры (`smoothstep(FAR,NEAR,dist)`), detail albedo (вариация вокруг биом-цвета) + detail normal (складывается с кратер-микрорельефом 2A). Без тайл-стриминга — процедурно, без доп. данных.

**Tech Stack:** TypeScript, three 0.185 (`three/webgpu`+`three/tsl`), vitest. WebGPU + откат WebGL2.

## Global Constraints

- Комментарии/имена — **русский**; технические термины/код — как есть.
- **Никакого динамического света** — рельеф читается статичным светом сцены.
- **Ноль аллокаций на кадр** (шейдер, без новой геометрии).
- **Рефактор шума — поведение байт-в-байт:** вынос `hash/noise/fbm` в `noise.ts` НЕ меняет вид воды (OceanShell) и кратера (2A); существующие тесты остаются зелёными.
- **Detail НЕ ломает 2A:** кратер-зоны цвета (стекло/порода/пыль/полынья) доминируют по своей маске; detail-нормаль складывается с кратер-микрорельефом согласованно (обе до `mix(materialNormal,…)`).
- **Океан не маскируем отдельно:** океан-пиксели глобуса скрыты водной оболочкой (№1) — detail применяется ко всем фрагментам суши глобуса, отдельная landmask в шейдере не нужна.
- **Визуальную/перф-приёмку НЕ автоматизируем** — вид/перф проверит пользователь. Автоматом: `npm test`, `npm run build` (tsc), `npm run lint`.
- Без изменений: sim/геймплей, сетка глобуса (384×192), суть воды, кратер-логика 2A (только складываем нормали).

**Автономные решения (§11 спеки):** маска суши в шейдере — НЕ нужна (океан скрыт оболочкой); рампа дистанции — чистый хелпер `detailStrength` (тестируемый) + `smoothstep` в TSL с теми же константами; biome-aware — минимально (амплитуда вариации от яркости базового биом-цвета).

---

## Файловая структура

- **Создать** `src/render/noise.ts` — общий TSL-шум (`hash`/`noise3`/`fbm`), перенос из OceanShell/GlobeView.
- **Изменить** `src/render/OceanShell.ts` — импорт шума из `noise.ts` (убрать дубль, поведение не меняется).
- **Изменить** `src/render/GlobeView.ts` — импорт шума + detail-слой (albedo/normal/дистанция).
- **Создать** `src/render/effects/detailStrength.ts` — чистая рампа силы детали по дистанции.
- **Создать** `test/render/detailStrength.test.ts` — vitest на рампу.
- **Изменить** `src/assets/config.ts` — detail-константы.

---

## Task 1: noise.ts — общий шум (рефактор без смены поведения)

**Files:**
- Create: `src/render/noise.ts`
- Modify: `src/render/OceanShell.ts`
- Modify: `src/render/GlobeView.ts`

**Interfaces:**
- Produces (`noise.ts`, TSL-`Fn`): `hash3(p)`, `noise3(p)`, `fbm3(p, octaves: number)` — идентичны текущим `hash`/`noise`/`fbm` в OceanShell/GlobeView (та же решётка, `0.3183099`, `.mul(17.0)`, trilinear, `2.02`/`0.5`). `fbm3` принимает число октав (OceanShell использует 5, GlobeView-кратер — `CRATER_DETAIL_OCTAVES`).

> Чистая численная логика шума headless-тестируема лишь косвенно (TSL-узлы). Приёмка задачи: существующие тесты зелёные + `npm run build`/`lint` + вид воды/кратера НЕ изменился (ручной визуал пользователя позже — но рефактор поведение-сохраняющий).

- [ ] **Step 1: Создать `noise.ts`**

Перенести дословно текущие `hash`/`noise`/`fbm` (`Fn`) из `src/render/OceanShell.ts` (строки ~74-96)
в `src/render/noise.ts`, экспортировав как `hash3`/`noise3`/`fbm3`. `fbm3` — с параметром октав
(как уже в GlobeView-версии). Комментарии — русский. Пример каркаса:

```ts
// src/render/noise.ts
// Общий процедурный шум на TSL (value-noise + fbm) — единый источник для воды (OceanShell),
// микрорельефа кратера и detail-слоя суши (GlobeView). Перенос дублировавшихся hash/noise/fbm.
import { Fn, float, vec3, floor, fract, dot, mix /* + что используется в оригинале */ } from 'three/tsl';
// hash3(p): детерминированный хеш решётки; noise3(p): trilinear value-noise; fbm3(p, octaves): сумма октав.
// ТЕЛА — дословно из текущего OceanShell (та же решётка/константы), чтобы поведение не изменилось.
export const hash3 = /* Fn(...) */;
export const noise3 = /* Fn(...) */;
export const fbm3 = /* Fn(([p, octaves]) => ...) */;
```
(Точные тела взять из существующего кода — НЕ переписывать формулы, только перенести и переименовать.)

- [ ] **Step 2: Перевести OceanShell на `noise.ts`**

В `src/render/OceanShell.ts` удалить локальные `hash`/`noise`/`fbm`, импортировать из `./noise`
(`fbm3(p, 5)` там, где было `fbm(p)` с 5 октавами). Формулы волн/нормали — без изменений.

- [ ] **Step 3: Перевести GlobeView-кратер на `noise.ts`**

В `src/render/GlobeView.ts` удалить локальные `hash`/`noise`/`fbm` (2A-микрорельеф), импортировать из
`./noise` (`fbm3(p, CRATER_DETAIL_OCTAVES)`). Микрорельеф кратера — без изменений поведения.

- [ ] **Step 4: Проверка (поведение сохранено)**

Run: `npm test` → все существующие зелёные (craterProfile/ejecta/вода/прочее).
Run: `npm run build` → без ошибок. `npm run lint` → чисто.

- [ ] **Step 5: Коммит**

```bash
git add src/render/noise.ts src/render/OceanShell.ts src/render/GlobeView.ts
git commit -m "refactor(render): вынести общий TSL-шум в noise.ts (дедуп OceanShell/GlobeView)"
```

---

## Task 2: detailStrength — чистая рампа силы детали (TDD)

**Files:**
- Create: `src/render/effects/detailStrength.ts`
- Test: `test/render/detailStrength.test.ts`
- Modify: `src/assets/config.ts` (`DETAIL_NEAR`, `DETAIL_FAR`)

**Interfaces:**
- Produces: `detailStrength(dist: number, near: number, far: number): number` — сглаженная рампа:
  `dist ≤ near` → 1 (полная деталь вблизи), `dist ≥ far` → 0 (нет детали вдали), между —
  `smoothstep`; результат в [0,1]. (Та же форма пойдёт в TSL: `smoothstep(far, near, dist)`.)

- [ ] **Step 1: Падающий тест**

```ts
// test/render/detailStrength.test.ts
import { describe, it, expect } from 'vitest';
import { detailStrength } from '../../src/render/effects/detailStrength';

describe('detailStrength', () => {
  it('вблизи (dist≤near) — полная деталь = 1', () => {
    expect(detailStrength(1.5, 2.0, 4.0)).toBeCloseTo(1, 5);
    expect(detailStrength(2.0, 2.0, 4.0)).toBeCloseTo(1, 5);
  });
  it('вдали (dist≥far) — деталь = 0', () => {
    expect(detailStrength(4.0, 2.0, 4.0)).toBeCloseTo(0, 5);
    expect(detailStrength(6.0, 2.0, 4.0)).toBeCloseTo(0, 5);
  });
  it('между — монотонно убывает с дистанцией, в [0,1]', () => {
    const mid = detailStrength(3.0, 2.0, 4.0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(detailStrength(2.5, 2.0, 4.0)).toBeGreaterThan(detailStrength(3.5, 2.0, 4.0));
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- detailStrength` → Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать + константы**

```ts
// src/render/effects/detailStrength.ts
// Сила процедурной детализации суши по дистанции камеры до фрагмента: вблизи 1, вдали 0.
// Та же форма (smoothstep(far, near, dist)) применяется в TSL-шейдере GlobeView.
export function detailStrength(dist: number, near: number, far: number): number {
  const t = Math.min(1, Math.max(0, (dist - far) / (near - far)));
  return t * t * (3 - 2 * t);
}
```

Добавить в `src/assets/config.ts`:
```ts
// Процедурная детализация суши на зуме (дистанции камеры до поверхности; радиус планеты = 1).
export const DETAIL_NEAR = 2.0; // ближе — полная деталь
export const DETAIL_FAR = 3.6; // дальше — детали нет (как раньше)
export const DETAIL_ALBEDO_AMP = 0.16; // амплитуда вариации цвета
export const DETAIL_NORMAL_STR = 0.5; // сила микрорельефа суши
export const DETAIL_FREQ = 60.0; // частота detail-шума (высокая — мелкая деталь)
export const DETAIL_OCTAVES = 3;
```

- [ ] **Step 4: Тест зелёный**

Run: `npm test -- detailStrength` → PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/render/effects/detailStrength.ts test/render/detailStrength.test.ts src/assets/config.ts
git commit -m "feat(render): detailStrength — рампа силы детализации по дистанции камеры"
```

---

## Task 3: GlobeView — detail albedo + normal по дистанции

**Files:**
- Modify: `src/render/GlobeView.ts`

**Interfaces:**
- Consumes: `noise.ts` (`fbm3`), `detailStrength`-константы (`DETAIL_*`), `cameraPosition`/`positionWorld`.
- Produces: детализированная суша на зуме.

> GPU headless НЕ тестируется. Приёмка: `npm run build` + `npm run lint` + ручной визуал пользователя.

- [ ] **Step 1: Дистанция камеры → detailK**

В `src/render/GlobeView.ts` (в блоке материала, где уже есть доступ к узлам). Дистанцию считать
как в `buildAtmosphere` (`cameraPosition`, `positionWorld`):
```ts
const camDist = length(sub(cameraPosition, positionWorld));
const detailK = smoothstep(float(DETAIL_FAR), float(DETAIL_NEAR), camDist); // 0 далеко → 1 близко
```
(Импортировать `length`, `sub`, `cameraPosition`, `positionWorld`, `smoothstep`, `DETAIL_*`.)

- [ ] **Step 2: Detail albedo — вариация вокруг биом-цвета**

Взять высокочастотный шум по `positionLocal·DETAIL_FREQ` и модулировать базовый биом-цвет. Biome-aware:
амплитуда от яркости base. Вставить ПОСЛЕ вычисления `base` (биом-цвет), ДО кратер-зон (чтобы кратер
доминировал поверх):
```ts
const detN = fbm3(positionLocal.mul(float(DETAIL_FREQ)), DETAIL_OCTAVES); // 0..1
const detVar = detN.sub(0.5).mul(float(DETAIL_ALBEDO_AMP)).mul(detailK);
const baseDetailed = base.mul(float(1).add(detVar)); // мелкая светлотная вариация
// далее кратер-зоны/полынья считаются от baseDetailed вместо base
```
(Убедиться, что последующие `scorched/dusted/rocky/glass/ice` строятся от `baseDetailed`.)

- [ ] **Step 3: Detail normal — микрорельеф суши, сложить с кратер-микрорельефом**

Detail-нормаль по тому же приёму, что кратер-микрорельеф (конечные разности `fbm3` в касательном
базисе `positionLocal`), но частота `DETAIL_FREQ`, сила `detailK·DETAIL_NORMAL_STR`. Сложить возмущение
с кратер-возмущением ДО `mix(materialNormal, …)`:
```ts
// пусть craterPerturb — существующее локальное возмущение нормали 2A (до перевода в view).
// detailPerturb — аналогично, но с DETAIL_FREQ и силой detailK·DETAIL_NORMAL_STR.
// суммарное локальное возмущение = craterPerturb + detailPerturb, затем transformNormalToView + mix.
```
Реализатор: аккуратно встроить в текущую структуру `normalNode` GlobeView (2A) — переиспользовать
касательный базис/finite-diff, добавив второй масштаб. Отметить в отчёте, как сложены две детали.

- [ ] **Step 4: Сборка/линт**

Run: `npm run build` → без ошибок. `npm run lint` → чисто.

- [ ] **Step 5: Ручной визуал (пользователь, позже)** — при приближении суша детализируется (нет
блоков/мыла), вдали вид как раньше; кратер-зоны не зашумлены в ноль; перф.

- [ ] **Step 6: Коммит**

```bash
git add src/render/GlobeView.ts
git commit -m "feat(render): GlobeView — процедурная детализация суши на зуме (albedo+normal по дистанции)"
```

---

## Self-Review (при написании)

- **Покрытие спеки:** §4 `noise.ts` → Task 1; distance-ramp → Task 2 (`detailStrength`); detail albedo/normal → Task 3; §7 перф (переиспользование шума, малые октавы) → Task 3 (один `fbm3` для albedo, отдельный для normal — отметить стоимость).
- **Заглушки:** тела шума помечены «перенести дословно из существующего» (не placeholder — конкретный источник, поведение-сохраняющий); TSL detail-нормаль — «встроить в структуру 2A normalNode» с указанием приёма. Реализатор адаптирует по факту.
- **Согласованность:** `fbm3(p, octaves)` — единый контракт Task 1, используется в OceanShell(5)/кратер(CRATER_DETAIL_OCTAVES)/detail(DETAIL_OCTAVES); `detailStrength` форма ↔ TSL `smoothstep(FAR,NEAR,dist)`; `DETAIL_*` константы едины.
- **Риск:** рефактор шума (Task 1) должен быть строго поведение-сохраняющим — если тела формул расходятся между OceanShell и GlobeView-версией (проверить!), взять корректную и отметить; существующие тесты + вид воды/кратера — контроль.
