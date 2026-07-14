# Трещины и целостность (этап 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Светящиеся пульсирующие трещины вокруг глубоких пробитий коры + метрика целостности коры в HUD.

**Architecture:** Спека `docs/superpowers/specs/2026-07-14-cracks-integrity-design.md`. Очаги трещин копятся в свободном R-канале DamageField (ping-pong max, ноль новых RT); рисунок жил — процедурный ridged-fbm в общем TSL-узле, эмиссивно подключаемом в материалы GlobeView и CrustView. `Crust` считает `deepestLayer` на carve и `integrity()` от бюджета `CRUST_DOOM_VOXELS`; HUD раз за кадр показывает процент.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, vitest.

## Global Constraints

- Общение и комментарии — на русском (CLAUDE.md).
- NodeMaterial-грабли: клампить выходы ≥0; opacity непрозрачных материалов не трогать.
- Детерминизм; без Math.random в рантайме; ноль лишней работы CPU на кадр.
- Ветка `feat/cracks-integrity` от master; частые коммиты с Co-Authored-By Claude.
- Визуальную приёмку не гоняем (смотрит юзер). Проверки: `npm test`, `npm run build`, `npm run lint`.

---

### Task 1: Crust — deepestLayer, integrity(), crackStrengthForDepth

**Files:**
- Modify: `src/crust/Crust.ts` (интерфейс CarveResult, тело carve, новые методы)
- Modify: `src/assets/config.ts` (конец файла)
- Test: `test/crust/carve.test.ts` (дописать)

**Interfaces (Produces):**
- `CarveResult.deepestLayer: number` — самый глубокий слой d, выбитый ЭТИМ carve; −1 если ничего.
- `Crust.integrity(): number` — `clamp(1 − removedVoxels / CRUST_DOOM_VOXELS, 0, 1)`.
- `crackStrengthForDepth(deepestLayer: number): number` — 0 при слое <5; `(d−4)/(CRUST_DEPTH_LAYERS−5)` c клампом [0,1] иначе.
- Конфиг: `CRUST_DOOM_VOXELS = 20_000`.

- [ ] **Step 1: Падающие тесты** — в конец describe в `test/crust/carve.test.ts`:

```ts
  it('deepestLayer: глубокий удар достаёт базальт, мелкий — нет, океан — −1', () => {
    expect(new Crust().carve(SAHARA, 0.046, 5, 42).deepestLayer).toBeGreaterThanOrEqual(5);
    const shallow = new Crust().carve(SAHARA, 0.009, 1, 42).deepestLayer;
    expect(shallow).toBeGreaterThanOrEqual(0);
    expect(shallow).toBeLessThan(5);
    expect(new Crust().carve(PACIFIC, 0.046, 5, 42).deepestLayer).toBe(-1);
  });

  it('integrity: 1 у свежей коры, падает ровно на removed/бюджет, reset возвращает 1', () => {
    const crust = new Crust();
    expect(crust.integrity()).toBe(1);
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    expect(crust.integrity()).toBeCloseTo(1 - res.removed / CRUST_DOOM_VOXELS, 10);
    crust.reset();
    expect(crust.integrity()).toBe(1);
  });

  it('crackStrengthForDepth: 0 до базальта, растёт с глубиной до 1', () => {
    expect(crackStrengthForDepth(-1)).toBe(0);
    expect(crackStrengthForDepth(4)).toBe(0);
    expect(crackStrengthForDepth(5)).toBeCloseTo(1 / 3, 10);
    expect(crackStrengthForDepth(7)).toBe(1);
    expect(crackStrengthForDepth(99)).toBe(1);
  });
```

Импорты дописать: `crackStrengthForDepth` из Crust, `CRUST_DOOM_VOXELS` из config.

- [ ] **Step 2:** `npx vitest run test/crust/carve.test.ts` → FAIL (нет поля/функций).

- [ ] **Step 3: Реализация** — в `src/assets/config.ts` (в конец):

```ts
// ---------- Трещины и целостность (спека 2026-07-14-cracks-integrity-design.md) ----------
// «Бюджет гибели» коры: выбитых вокселей, при которых integrity()=0 (порог раскола, этап 4).
// Честная доля всей коры (~912k вокселей суши) недостижима игрой — бюджет геймплейный:
// ~34 удара по 100 Мт (≈590 вокселей каждый).
export const CRUST_DOOM_VOXELS = 20_000;
```

В `src/crust/Crust.ts`: поле `deepestLayer: number;` в CarveResult (комментарий: «самый глубокий слой, выбитый этим ударом; −1 если ничего»); в carve() рядом с `removedByMat` — `let deepestLayer = -1;`, в цикле после `removed++` — `if (d > deepestLayer) deepestLayer = d;`, в return добавить. Методы после `reset()`:

```ts
  // Целостность коры [0..1]: 1 − выбитое/бюджет гибели (CRUST_DOOM_VOXELS — геймплейный
  // порог этапа 4 «раскол», не честная доля всей коры). Кламп снизу — не уходит в минус.
  integrity(): number {
    return Math.min(1, Math.max(0, 1 - this.removedVoxels / CRUST_DOOM_VOXELS));
  }
```

И экспорт чистой функции (после pristineMaterial):

```ts
// Сила трещинного очага по глубине пробития carve: базальт (слой 5) едва трещит (~⅓),
// пробитие до магмы (слой 7) — максимум. До базальта очага нет.
export function crackStrengthForDepth(deepestLayer: number): number {
  if (deepestLayer < 5) return 0;
  return Math.min(1, (deepestLayer - 4) / (CRUST_DEPTH_LAYERS - 5));
}
```

(Импорт `CRUST_DOOM_VOXELS` в Crust.ts добавить к существующему import из config.)

- [ ] **Step 4:** `npx vitest run test/crust` → PASS.
- [ ] **Step 5:** Commit `feat(crust): deepestLayer + integrity() + crackStrengthForDepth`.

---

### Task 2: DamageField — R-канал = очаги трещин

**Files:**
- Modify: `src/render/DamageField.ts`
- Modify: `src/assets/config.ts` (конец блока этапа 3)

**Interfaces (Produces):** `splat(dir, yieldMt, kind, crack = 0)` — crack ∈ [0,1], сила очага; R-канал поля отныне = интенсивность трещин (спад от ямы наружу), G/B/A без изменений. Конфиг: `CRACK_EXTENT_FRAC = 2.4` (докуда стелются трещины, в долях радиуса штампа).

- [ ] **Step 1: Реализация** — в config (в блок этапа 3):

```ts
export const CRACK_EXTENT_FRAC = 2.4; // докуда стелются трещины (доли радиуса штампа поля)
```

В DamageField:
1. Шапка файла: заменить описание канала R на «R=очаги трещин (сила × спад от ямы; пишется только глубокими пробитиями, см. Scene)»; A оставить как есть.
2. Юниформ: `private readonly uCrack: FloatUniform;` → в конструкторе `this.uCrack = makeFloatUniform(0);`.
3. Штамп: заменить строку `const depth = ...` (R-профиль чаши) на:

```ts
    // R — очаг трещин: спад от края ямы наружу до CRACK_EXTENT_FRAC, гейт силой очага
    // (uCrack=0 у неглубоких ударов — канал не трогается: max с prev сохраняет старое).
    const crack = this.uCrack.mul(oneMinus(smoothstep(float(0.5), float(CRACK_EXTENT_FRAC), dNorm)));
```

и в `vec4(...)` первым каналом `clamp(crack, 0, 1)` вместо `clamp(depth, 0, 1)`. ВНИМАНИЕ: `melt` использует `depth` — заменить его определение на `const bowl = oneMinus(smoothstep(float(0), float(1), dNorm));` и `const melt = clamp(bowl.mul(this.uKind), 0, 1);` (профиль чаши для полыньи сохраняется, меняется только НАЗНАЧЕНИЕ канала R).
4. Сигнатура: `splat(dir: Vec3, yieldMt: number, kind: 'land' | 'ice', crack = 0): void` и в теле `this.uCrack.value = crack;`. Импорт `CRACK_EXTENT_FRAC`.

- [ ] **Step 2:** `npx tsc --noEmit` → 0 ошибок; `npm test` → PASS (полей юнит-тестов нет — регрессий быть не должно).
- [ ] **Step 3:** Commit `feat(render): R-канал DamageField — очаги трещин (uCrack, спад от ямы)`.

---

### Task 3: cracks.ts — общий эмиссивный узел; подключение в GlobeView и CrustView

**Files:**
- Create: `src/render/effects/cracks.ts`
- Modify: `src/render/GlobeView.ts`, `src/render/CrustView.ts`
- Modify: `src/assets/config.ts`

**Interfaces (Produces):**
- `crackEmissiveNode(crackR: FloatNode, p: Vec3Node, uTime: FloatUniform): Vec3Node` — эмиссивный вклад трещин; `FloatNode`/`Vec3Node` — типы узлов как в noise.ts.
- `GlobeView.setTime(t: number)`, `CrustView.setTime(t: number)` (для Task 4).
- Конфиг: `CRACK_FREQ = 26`, `CRACK_EDGE0 = 0.86`, `CRACK_EDGE1 = 0.97`, `CRACK_COLOR = [1.0, 0.42, 0.1]`, `CRACK_INTENSITY = 1.6`.

- [ ] **Step 1: Конфиг** (в блок этапа 3):

```ts
export const CRACK_FREQ = 26; // частота рисунка жил (ridged fbm по направлению фрагмента)
export const CRACK_EDGE0 = 0.86; // порог начала жилы (ширина линий: ближе к EDGE1 — тоньше)
export const CRACK_EDGE1 = 0.97;
export const CRACK_COLOR = [1.0, 0.42, 0.1] as const; // магма (согласовано с MagmaCore)
export const CRACK_INTENSITY = 1.6; // множитель эмиссии (перекрывает гарь-затемнение)
```

- [ ] **Step 2: Узел** — `src/render/effects/cracks.ts`:

```ts
// Светящиеся трещины от глубоких очагов (этап 3, спека 2026-07-14): процедурные «жилы» —
// ridged fbm по направлению фрагмента (не зависит от разрешения поля урона — мыла на зуме
// нет), гейт — R-канал DamageField (сила очага со спадом от ямы), пульс — sin от общих часов.
// Общий узел для GlobeView (поверхность) и CrustView (воксельные чанки): рисунок зависит
// только от направления и поля — на границе дискарда глобус/чанк совпадает по построению.
import { vec3, float, clamp, sin, abs, oneMinus, smoothstep } from 'three/tsl';
import { fbm3 } from '../noise';
import {
  CRACK_FREQ,
  CRACK_EDGE0,
  CRACK_EDGE1,
  CRACK_COLOR,
  CRACK_INTENSITY,
} from '../../assets/config';

type FloatNode = ReturnType<typeof float>;
type Vec3Node = ReturnType<typeof vec3>;

export function crackEmissiveNode(crackR: FloatNode, p: Vec3Node, uTime: FloatNode): Vec3Node {
  // Ридж: жилы там, где fbm проходит через середину диапазона (|2x−1|→0).
  const ridge = oneMinus(abs(fbm3(p.mul(CRACK_FREQ), 4).mul(2).sub(1)));
  const veins = smoothstep(float(CRACK_EDGE0), float(CRACK_EDGE1), ridge);
  const pulse = float(0.78).add(sin(uTime.mul(1.7)).mul(0.22));
  const glow = clamp(veins.mul(crackR).mul(pulse).mul(CRACK_INTENSITY), 0, CRACK_INTENSITY);
  return vec3(CRACK_COLOR[0], CRACK_COLOR[1], CRACK_COLOR[2]).mul(glow);
}
```

(Точные типы аргументов при трениях tsc подогнать под фактические ReturnType — как Vec3Node в CrustView.)

- [ ] **Step 3: GlobeView** — импорт `uniform`, `normalize`, `positionLocal` из three/tsl (часть уже есть), `crackEmissiveNode`; в классе:

```ts
  private readonly uTime = uniform(0);
```

в конструкторе после `earthMaterial.colorNode = ...`:

```ts
    // Светящиеся трещины глубоких очагов (R поля урона) — эмиссивно, поверх гари.
    earthMaterial.emissiveNode = crackEmissiveNode(dmg.r, normalize(positionLocal), this.uTime);
```

и метод:

```ts
  // Часы шейдера трещин (пульс) — толкает Scene.update раз за кадр.
  setTime(t: number): void {
    this.uTime.value = t;
  }
```

(типизация юниформа: `private readonly uTime;` с инициализацией через локальный `makeFloatUniform`-паттерн, как в MagmaCore, если голый `uniform(0)` размывает тип .value.)

- [ ] **Step 4: CrustView** — то же: поле `uTime` (makeFloatUniform-паттерн), импорт `crackEmissiveNode`; после `mat.colorNode = col;`:

```ts
    // Трещины и на воксельных чанках (крышки/склоны) — без шва с глобусом (общий узел).
    mat.emissiveNode = crackEmissiveNode(dmg.r, p, this.uTime);
```

(`p` уже есть — normalize(positionLocal); `dmg` уже сэмплится.) Метод `setTime(t)` — как в GlobeView.

- [ ] **Step 5:** `npx tsc --noEmit` → 0 ошибок.
- [ ] **Step 6:** Commit `feat(render): светящиеся трещины — общий TSL-узел, эмиссия в GlobeView и CrustView`.

---

### Task 4: Scene — сила очага при carve + часы + integrity-геттер

**Files:**
- Modify: `src/render/Scene.ts`

**Interfaces:**
- Consumes: `crackStrengthForDepth`, `carved.deepestLayer` (Task 1), `splat(..., crack)` (Task 2), `setTime` (Task 3).
- Produces (для Task 5): `Scene.crustIntegrity: number` (getter).

- [ ] **Step 1: Реализация**
1. Импорт: `import { Crust, crackStrengthForDepth } from '../crust/Crust';` (Crust уже импортирован — дополнить).
2. Сохранить globe полем: в конструкторе заменить комментарий «ctx/globe/host не сохраняются полями» — globe теперь поле (`private readonly globe: GlobeView` через параметр конструктора НЕЛЬЗЯ — он уже позиционный; добавить `this.globe = globe;` с объявлением поля `private readonly globe: GlobeView;`) — нужен для setTime.
3. В `startExplosion` ветке суши/льда: перенести блок `const carved = this.crust.carve(...)` + `this.crustView.update(...)` ВЫШЕ строки `this.damageField.splat(...)` и заменить splat на:

```ts
      this.damageField.splat(
        dir,
        yieldMt,
        surface === 'ice' ? 'ice' : 'land',
        crackStrengthForDepth(carved.deepestLayer),
      );
```

(holeMask.markCarve и debris-блок остаются после, порядок между собой прежний.)
4. В `update()`: `this.globe.setTime(this.clock);` и `this.crustView.setTime(this.clock);` рядом с `this.magma.setTime`.
5. Геттер:

```ts
  // Целостность коры [0..1] — для HUD (main.ts опрашивает раз за кадр).
  get crustIntegrity(): number {
    return this.crust.integrity();
  }
```

- [ ] **Step 2:** `npx tsc --noEmit` → 0; `npm test` → PASS.
- [ ] **Step 3:** Commit `feat(render): очаг трещин по глубине пробития + часы трещин + crustIntegrity`.

---

### Task 5: HUD-процент целостности + проводка в main

**Files:**
- Modify: `src/ui/Hud.ts`, `src/main.ts`

**Interfaces:** `Hud.setIntegrity(v: number): void` — v ∈ [0,1]; DOM обновляется только при смене целого процента; окраска порогами (≥70% обычная, <70% жёлтая, <35% красная).

- [ ] **Step 1: Hud** — в разметке `#stats` дописать строку (внутрь innerHTML, после «Жертвы»):

```html
<br>Целостность коры: <b id="integrity">100%</b>
```

Поле `private readonly integrityEl: HTMLElement;` + в конструкторе `this.integrityEl = root.querySelector<HTMLElement>('#integrity')!;`. Кэш `private lastIntegrityPct = 100;` и метод:

```ts
  // Целостность коры (0..1) — опрашивается main.ts раз за кадр; DOM трогаем только при
  // смене целого процента. Пороги окраски: <70% жёлтый, <35% красный (задел этапа 4).
  setIntegrity(v: number): void {
    const pct = Math.round(v * 100);
    if (pct === this.lastIntegrityPct) return;
    this.lastIntegrityPct = pct;
    this.integrityEl.textContent = `${pct}%`;
    this.integrityEl.style.color = pct < 35 ? '#ff5544' : pct < 70 ? '#ffcc44' : '';
  }
```

- [ ] **Step 2: main.ts** — в кадровом колбэке после `scene.update(frame);`:

```ts
      hud.setIntegrity(scene.crustIntegrity);
```

- [ ] **Step 3:** `npm test` → PASS; `npm run build` → ок; `npm run lint` → чисто (prettier --write при жалобах).
- [ ] **Step 4:** Commit `feat(ui): целостность коры в HUD (%, пороги окраски)`.

---

### Task 6: Банк памяти + мёрж

- [ ] **Step 1:** `memory-bank/activeContext.md`: текущий фокус — этап 3 реализован; следующий — этап 4 (раскол при integrity=0). `memory-bank/progress.md`: статус + раздел «Трещины и целостность (2026-07-14)» (чеклист: deepestLayer/integrity/crackStrength, R-канал DamageField, cracks.ts в двух материалах, HUD; визуал — за юзером). Убрать устаревшую пометку «integrity() — этап 3» из раздела воксельной коры (метрика теперь есть).
- [ ] **Step 2:**

```bash
git add memory-bank && git commit -m "docs(memory-bank): трещины и целостность (этап 3) — реализовано"
git checkout master && git merge --no-ff feat/cracks-integrity -m "Мёрж: трещины и целостность (этап 3 реальной разрушаемости)"
npm test
```

Expected: тесты зелёные на master.

---

## Self-Review (выполнен)

- **Покрытие спеки:** §3.1→Task 1; §3.2→Task 2; §3.3→Task 3; §3.4→Tasks 4-5; §4 юнит→Task 1. Пробелов нет.
- **Плейсхолдеры:** нет; альтернативы типизации TSL даны кодом/паттерном (MagmaCore/CrustView).
- **Типы:** `crackStrengthForDepth` (Tasks 1/4), `splat(..., crack)` (Tasks 2/4), `setTime` (Tasks 3/4), `crustIntegrity`/`setIntegrity` (Tasks 4/5) — согласованы.
