# Раскол планеты (этап 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При integrity()=0 — агония с разгорающимися трещинами, затем распад планеты на рой осколков вокруг магмы-ядра; баннер в HUD; reset всё возвращает.

**Architecture:** Спека `docs/superpowers/specs/2026-07-14-planet-shatter-design.md`. Машина состояний `render/shatterState.ts` (чистый TS, тесты); глобальный буст трещин — 4-й аргумент общего узла cracks.ts; скрытие планеты + `DebrisView.emitShatter` + буст MagmaCore при переходе; Scene дирижирует, main прокидывает в Hud/tiles.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WebAudio, vitest.

## Global Constraints

- Русский язык; NodeMaterial: кламп ≥0; детерминизм (LCG от seed); ноль аллокаций на кадр.
- Ветка `feat/planet-shatter`; частые коммиты с Co-Authored-By Claude.
- Визуальную приёмку не гоняем. Проверки: `npm test`, `npm run build`, `npm run lint`.

---

### Task 1: ShatterState + конфиг

**Files:**
- Create: `src/render/shatterState.ts`
- Modify: `src/assets/config.ts` (в конец)
- Test: `test/render/shatterState.test.ts`

**Interfaces (Produces):**
- `class ShatterState { readonly phase: 'intact'|'agony'|'shattered'; readonly boost: number; trigger(): void; update(dt: number): 'shatter' | null; reset(): void }`
- Конфиг: `SHATTER_AGONY_T = 4.5`, `SHATTER_SHARD_COUNT = 140`, `SHATTER_SHARD_SIZE_MIN = 0.05`, `SHATTER_SHARD_SIZE_MAX = 0.18`, `SHATTER_SHARD_R_MIN = 1.05`, `SHATTER_SHARD_R_MAX = 1.9`, `SHATTER_SHARD_OMEGA_MIN = 0.05`, `SHATTER_SHARD_OMEGA_MAX = 0.2`.

- [ ] **Step 1: Падающие тесты** — `test/render/shatterState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ShatterState } from '../../src/render/shatterState';
import { SHATTER_AGONY_T } from '../../src/assets/config';

describe('ShatterState', () => {
  it('intact: update ничего не делает, boost=0', () => {
    const s = new ShatterState();
    expect(s.phase).toBe('intact');
    expect(s.update(1)).toBeNull();
    expect(s.boost).toBe(0);
  });

  it('trigger переводит в агонию; boost растёт линейно до 1 за SHATTER_AGONY_T', () => {
    const s = new ShatterState();
    s.trigger();
    expect(s.phase).toBe('agony');
    s.update(SHATTER_AGONY_T / 2);
    expect(s.boost).toBeCloseTo(0.5, 10);
  });

  it("переход в shattered возвращает 'shatter' ровно один раз; после boost=1", () => {
    const s = new ShatterState();
    s.trigger();
    expect(s.update(SHATTER_AGONY_T + 0.1)).toBe('shatter');
    expect(s.phase).toBe('shattered');
    expect(s.boost).toBe(1);
    expect(s.update(1)).toBeNull(); // второй раз события нет
  });

  it('повторный trigger в agony/shattered — no-op', () => {
    const s = new ShatterState();
    s.trigger();
    s.update(SHATTER_AGONY_T / 2);
    const b = s.boost;
    s.trigger();
    expect(s.phase).toBe('agony');
    expect(s.boost).toBe(b); // агония не перезапустилась
    s.update(SHATTER_AGONY_T);
    s.trigger();
    expect(s.phase).toBe('shattered');
  });

  it('reset из любой фазы возвращает intact/0', () => {
    const s = new ShatterState();
    s.trigger();
    s.update(SHATTER_AGONY_T + 1);
    s.reset();
    expect(s.phase).toBe('intact');
    expect(s.boost).toBe(0);
    expect(s.update(1)).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run test/render/shatterState.test.ts` → FAIL (модуля нет).

- [ ] **Step 3: Реализация** — конфиг (в конец config.ts):

```ts
// ---------- Раскол планеты (спека 2026-07-14-planet-shatter-design.md) ----------
export const SHATTER_AGONY_T = 4.5; // сек агонии (глобальный разгорающийся буст трещин)
export const SHATTER_SHARD_COUNT = 140; // крупных осколков раскола (орбитальный сегмент DebrisView)
export const SHATTER_SHARD_SIZE_MIN = 0.05;
export const SHATTER_SHARD_SIZE_MAX = 0.18;
export const SHATTER_SHARD_R_MIN = 1.05; // радиусы поля обломков вокруг ядра
export const SHATTER_SHARD_R_MAX = 1.9;
export const SHATTER_SHARD_OMEGA_MIN = 0.05; // рад/с — медленное кружение крупных осколков
export const SHATTER_SHARD_OMEGA_MAX = 0.2;
```

`src/render/shatterState.ts`:

```ts
// Машина состояний раскола планеты (этап 4, спека 2026-07-14): intact → agony → shattered.
// Чистый TS без three — живёт в Scene, тестируется headless. Сценарий: trigger() при
// integrity()=0, агония SHATTER_AGONY_T секунд с линейным ростом boost (глобальный буст
// трещин 0→1), затем однократное событие 'shatter' (Scene скрывает планету и спавнит
// осколки), дальше — вечное shattered до reset().
import { SHATTER_AGONY_T } from '../assets/config';

export type ShatterPhase = 'intact' | 'agony' | 'shattered';

export class ShatterState {
  private _phase: ShatterPhase = 'intact';
  private agonyT = 0;

  get phase(): ShatterPhase {
    return this._phase;
  }

  // Глобальный буст трещин [0..1]: 0 в intact, линейный рост за агонию, 1 в shattered.
  get boost(): number {
    if (this._phase === 'intact') return 0;
    if (this._phase === 'shattered') return 1;
    return Math.min(1, this.agonyT / SHATTER_AGONY_T);
  }

  // Запуск агонии (integrity()=0). Повторные вызовы — no-op (агония не перезапускается).
  trigger(): void {
    if (this._phase === 'intact') this._phase = 'agony';
  }

  // Тик часов агонии. Возвращает 'shatter' РОВНО ОДИН РАЗ — в кадр перехода agony→shattered.
  update(dt: number): 'shatter' | null {
    if (this._phase !== 'agony') return null;
    this.agonyT += dt;
    if (this.agonyT < SHATTER_AGONY_T) return null;
    this._phase = 'shattered';
    return 'shatter';
  }

  reset(): void {
    this._phase = 'intact';
    this.agonyT = 0;
  }
}
```

- [ ] **Step 4:** `npx vitest run test/render/shatterState.test.ts` → PASS (5 тестов).
- [ ] **Step 5:** Commit `feat(render): ShatterState — машина состояний раскола + конфиг`.

---

### Task 2: Буст трещин в cracks.ts/GlobeView/CrustView + буст магмы

**Files:**
- Modify: `src/render/effects/cracks.ts`, `src/render/GlobeView.ts`, `src/render/CrustView.ts`, `src/render/MagmaCore.ts`

**Interfaces (Produces):**
- `crackEmissiveNode(crackR, p, uTime, boost)` — 4-й аргумент FloatNode; `effCrack = clamp(crackR.add(boost), 0, 1)` вместо голого crackR.
- `GlobeView.setCrackBoost(v)`, `GlobeView.setPlanetVisible(v)` (глобус+атмосфера);
- `CrustView.setCrackBoost(v)`, `CrustView.setVisible(v)`;
- `MagmaCore.setBoost(v)` — цвет к бело-жёлтому и ярче.

- [ ] **Step 1: cracks.ts** — сигнатура и первая строка тела:

```ts
export function crackEmissiveNode(
  crackR: FloatNode,
  p: Vec3Node,
  uTime: FloatNode,
  boost: FloatNode,
): Vec3Node {
  // Глобальный буст (агония раскола, этап 4): жилы разгораются по всей планете.
  const effCrack = clamp(crackR.add(boost), 0, 1);
```

и в `glow` заменить `crackR` на `effCrack`.

- [ ] **Step 2: GlobeView** — поле `private readonly uCrackBoost = makeFloatUniform(0);`, поле `private readonly atmoMesh: THREE.Mesh;`; в конструкторе заменить `this.spinGroup.add(this.buildAtmosphere(ctx));` на `this.atmoMesh = this.buildAtmosphere(ctx); this.spinGroup.add(this.atmoMesh);`; в вызов `crackEmissiveNode(...)` добавить 4-м аргументом `this.uCrackBoost`; методы:

```ts
  // Глобальный буст трещин (агония раскола, этап 4) — гонит Scene.update.
  setCrackBoost(v: number): void {
    this.uCrackBoost.value = v;
  }

  // Раскол: глобус и атмосфера скрываются (магма-ядро и осколки — забота Scene).
  setPlanetVisible(v: boolean): void {
    this.earthMesh.visible = v;
    this.atmoMesh.visible = v;
  }
```

- [ ] **Step 3: CrustView** — аналогично: `uCrackBoost` + 4-й аргумент + методы:

```ts
  setCrackBoost(v: number): void {
    this.uCrackBoost.value = v;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
```

- [ ] **Step 4: MagmaCore** — поле `uBoost` (makeFloatUniform(0)); в конструкторе итоговый цвет:

```ts
    const base = mix(vec3(0.45, 0.05, 0.0), vec3(1.0, 0.55, 0.1), glow);
    // Буст раскола (этап 4): обнажённое ядро разгорается к бело-жёлтому.
    mat.colorNode = mix(base, vec3(1.0, 0.85, 0.45), this.uBoost.mul(0.65));
```

и метод `setBoost(v: number): void { this.uBoost.value = v; }`.

- [ ] **Step 5:** `npx tsc --noEmit` → 0 ошибок.
- [ ] **Step 6:** Commit `feat(render): глобальный буст трещин + скрытие планеты + разгорание магмы`.

---

### Task 3: DebrisView.emitShatter + playShatter

**Files:**
- Modify: `src/render/DebrisView.ts`, `src/render/effects/sound.ts`

**Interfaces (Produces):**
- `DebrisView.emitShatter(seed: number, now: number): void` — SHATTER_SHARD_COUNT крупных вечных осколков в орбитальный сегмент; направления — равномерно по сфере из LCG.
- `playShatter(intensity: number): void` — длинный низкий грохот.

- [ ] **Step 1: emitShatter** — в DebrisView после `emit()` (импорты SHATTER_* добавить):

```ts
  // Раскол планеты (этап 4): рой КРУПНЫХ вечных осколков вокруг ядра — вся кора разом.
  // Пишутся в орбитальный сегмент (переживают всё до reset), поверх накопленного кольца.
  emitShatter(seed: number, now: number): void {
    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < SHATTER_SHARD_COUNT; i++) {
      // Направление старта — равномерно по сфере (вся кора раскалывается разом).
      const az = rnd() * TWO_PI;
      const cz = rnd() * 2 - 1;
      const sxy = Math.sqrt(Math.max(0, 1 - cz * cz));
      const dir = { x: sxy * Math.cos(az), y: sxy * Math.sin(az), z: cz };
      const angle = rnd() * TWO_PI;
      // Крупные осколки — порода/базальт с примесью грунта (верх коры в составе плит).
      const m = rnd() < 0.25 ? 'soil' : rnd() < 0.6 ? 'rock' : 'basalt';
      const [cr, cg, cb] =
        m === 'soil'
          ? DEBRIS_SOIL_COLOR
          : m === 'rock'
            ? CRUST_LAYER_COLORS.rock
            : CRUST_LAYER_COLORS.basalt;
      const bright = 0.85 + rnd() * 0.3;
      const size =
        SHATTER_SHARD_SIZE_MIN + rnd() * (SHATTER_SHARD_SIZE_MAX - SHATTER_SHARD_SIZE_MIN);
      const raz = rnd() * TWO_PI;
      const rcz = rnd() * 2 - 1;
      const rsxy = Math.sqrt(Math.max(0, 1 - rcz * rcz));
      const axis = { x: rsxy * Math.cos(raz), y: rsxy * Math.sin(raz), z: rcz };
      const omega =
        (SHATTER_SHARD_OMEGA_MIN + rnd() * (SHATTER_SHARD_OMEGA_MAX - SHATTER_SHARD_OMEGA_MIN)) *
        (rnd() < 0.5 ? -1 : 1);
      const orbitR = SHATTER_SHARD_R_MIN + rnd() * (SHATTER_SHARD_R_MAX - SHATTER_SHARD_R_MIN);
      this.writeDebris(
        this.slots.nextOrbital(),
        now,
        1,
        1,
        angle,
        0,
        0,
        omega,
        orbitR,
        dir,
        (0.2 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1), // медленное кувыркание крупных плит
        axis,
        rnd() * TWO_PI,
        size * (0.7 + rnd() * 0.6),
        size * (0.7 + rnd() * 0.6),
        size * (0.7 + rnd() * 0.6),
        cr * bright,
        cg * bright,
        cb * bright,
      );
    }
    this.flush();
  }
```

- [ ] **Step 2: playShatter** — в sound.ts после playBoom:

```ts
// Грохот раскола планеты (этап 4): длиннее и ниже взрыва — 10-секундный шум с ФНЧ,
// уходящей в инфразвук, поверх тона 34→14 Гц. intensity: 0.7 — старт агонии, 1.6 — распад.
export function playShatter(intensity: number): void {
  const ctx = audioCtx;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const dur = 10;

  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.8);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, t0);
  lp.frequency.exponentialRampToValueAtTime(18, t0 + dur);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.5 * intensity;
  noise.connect(lp).connect(noiseGain).connect(ctx.destination);
  noise.start(t0);

  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(34, t0);
  osc.frequency.exponentialRampToValueAtTime(14, t0 + dur);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.4 * intensity, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → 0.
- [ ] **Step 4:** Commit `feat(render): рой осколков раскола (emitShatter) + грохот playShatter`.

---

### Task 4: Scene — дирижирование расколом

**Files:**
- Modify: `src/render/Scene.ts`

**Interfaces:**
- Consumes: ShatterState (Task 1), setCrackBoost/setPlanetVisible/setVisible/setBoost (Task 2), emitShatter/playShatter (Task 3).
- Produces (для Task 5): `Scene.isShattered: boolean` (getter).

- [ ] **Step 1: Реализация**
1. Импорты: `ShatterState` из './shatterState', `playShatter` (дополнить импорт из './effects/sound').
2. Поле: `private readonly shatter = new ShatterState();`.
3. В `startExplosion` после блока carve/splat (внутри ветки суши, после debris-блока):

```ts
      // Финал (этап 4): нулевая целостность запускает агонию раскола (однократно).
      if (this.crust.integrity() <= 0 && this.shatter.phase === 'intact') {
        this.shatter.trigger();
        playShatter(0.7);
      }
```

4. В `handleEvent` первым делом в case 'missileLaunched' и 'explosionStarted' — гард:

```ts
      case 'missileLaunched':
        if (this.shatter.phase === 'shattered') break; // планеты нет — удары в пустоту глушим
        this.missileView.spawn(event.id, event.dir, event.yield);
        break;
      case 'explosionStarted':
        this.missileView.despawn(event.id);
        if (this.shatter.phase === 'shattered') break;
        this.startExplosion(...);
        break;
```

(despawn оставить до гарда — ракеты, выпущенные до раскола, убираются штатно.)
5. В `case 'planetReset':` в конец блока:

```ts
        this.shatter.reset();
        this.applyShatterVisuals(true);
```

6. В `update(dt)` после существующих setTime:

```ts
    // Раскол (этап 4): тик агонии, буст трещин/магмы, тряска; переход — прячем планету
    // и спавним рой осколков.
    const ev = this.shatter.update(dt);
    const boost = this.shatter.boost;
    this.globe.setCrackBoost(boost);
    this.crustView.setCrackBoost(boost);
    this.magma.setBoost(boost);
    if (this.shatter.phase === 'agony')
      this.rig.shake = Math.max(this.rig.shake, 0.05 * boost);
    if (ev === 'shatter') {
      this.applyShatterVisuals(false);
      this.debrisView.emitShatter(1337, this.clock);
      playShatter(1.6);
      this.rig.shake = Math.max(this.rig.shake, 0.12);
    }
```

7. Метод:

```ts
  // Видимость «планеты как целого»: глобус+атмосфера, океан, воксельные чанки.
  // false — раскол (остаются магма-ядро и осколки), true — восстановление.
  private applyShatterVisuals(visible: boolean): void {
    this.globe.setPlanetVisible(visible);
    this.oceanShell.mesh.visible = visible;
    this.crustView.setVisible(visible);
  }
```

8. Геттер:

```ts
  // Планета расколота? — для HUD-баннера и скрытия слоя тайлов (main.ts, раз за кадр).
  get isShattered(): boolean {
    return this.shatter.phase === 'shattered';
  }
```

- [ ] **Step 2:** `npx tsc --noEmit` → 0; `npm test` → PASS.
- [ ] **Step 3:** Commit `feat(render): Scene дирижирует расколом — агония, распад, глушение ударов, reset`.

---

### Task 5: HUD-баннер + main

**Files:**
- Modify: `src/ui/Hud.ts`, `src/main.ts`

**Interfaces:** `Hud.setShattered(v: boolean): void` — показ/скрытие баннера, кэш состояния.

- [ ] **Step 1: Hud** — в innerHTML сразу после `<h1>…</h1>`:

```html
      <div id="shatter" style="display: none">☠ ПЛАНЕТА РАСКОЛОТА</div>
```

Поля `private readonly shatterEl: HTMLElement;` + `private lastShattered = false;`; в конструкторе `this.shatterEl = root.querySelector<HTMLElement>('#shatter')!;`. Метод (рядом с setIntegrity):

```ts
  // Баннер раскола (этап 4) — опрашивается main.ts раз за кадр, DOM только при смене.
  setShattered(v: boolean): void {
    if (v === this.lastShattered) return;
    this.lastShattered = v;
    this.shatterEl.style.display = v ? '' : 'none';
  }
```

Стиль баннера — в `src/ui/styles.css`:

```css
#shatter {
  color: #ff5544;
  font-weight: bold;
  letter-spacing: 2px;
  margin: 4px 0 8px;
  text-shadow: 0 0 8px rgba(255, 60, 30, 0.7);
}
```

- [ ] **Step 2: main.ts** — после `hud.setIntegrity(scene.crustIntegrity);`:

```ts
      hud.setShattered(scene.isShattered);
      tiles.group.visible = !scene.isShattered;
```

- [ ] **Step 3:** `npm test` → PASS; `npm run build` → ок; `npm run lint` → чисто (prettier --write при жалобах).
- [ ] **Step 4:** Commit `feat(ui): баннер «Планета расколота» + скрытие тайлов при расколе`.

---

### Task 6: Банк памяти + мёрж

- [ ] **Step 1:** activeContext.md — этап 4 реализован, дорожная карта разрушаемости ЗАВЕРШЕНА; следующий фокус — из бэклога (Web Worker сим / сеть / и т.п., решает юзер). progress.md — статус + раздел «Раскол планеты (2026-07-14)».
- [ ] **Step 2:**

```bash
git add memory-bank && git commit -m "docs(memory-bank): раскол планеты (этап 4) — реализовано, дорожная карта закрыта"
git checkout master && git merge --no-ff feat/planet-shatter -m "Мёрж: раскол планеты (этап 4, финал реальной разрушаемости)"
npm test
```

---

## Self-Review (выполнен)

- **Покрытие спеки:** §3.1→Task 1; §3.2→Tasks 2-3; §3.3→Tasks 4-5; §4 юнит→Task 1. Пробелов нет.
- **Плейсхолдеры:** нет (гард в handleEvent показан кодом; `startExplosion(...)` — существующий вызов, меняется только вставка гарда).
- **Типы:** `trigger/update/reset/boost/phase` (Tasks 1/4), `setCrackBoost/setPlanetVisible/setVisible/setBoost` (Tasks 2/4), `emitShatter(seed, now)`/`playShatter(intensity)` (Tasks 3/4), `isShattered`/`setShattered` (Tasks 4/5) — согласованы.
