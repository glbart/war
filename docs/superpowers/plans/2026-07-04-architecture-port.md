# Порт демо на архитектуру — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести всю функциональность демо `reference/earth-nuke.html` на модульную архитектуру (Vite + TypeScript + ECS/miniplex + three.js WebGPU-рендерер с откатом на WebGL2), устранив лаги при частых ударах.

**Architecture:** Шов Command → Simulation → Events: ввод порождает команды, симуляция (ECS на miniplex, фиксированный таймстеп 30 Гц, seeded RNG) — единственный мутатор состояния и источник событий, рендер и UI — только читатели. Рендерер спрятан за интерфейсом; эффекты взрыва — GPU-инстансированные частицы на TSL (без динамического света и без per-взрыв аллокаций).

**Tech Stack:** Vite 8, TypeScript 6 (strict), three.js 0.185 (`three/webgpu` + `three/tsl`), miniplex 2, Vitest 4, ESLint 9 + Prettier.

## Global Constraints

- Node ≥ 24, npm ≥ 11 (доступно: node 24.10, npm 11.6).
- Зависимости (точные версии): `three@0.185.1`, `miniplex@2.0.0`, `vite@8.1.3`, `typescript@6.0.3`, `vitest@4.1.9`.
- **Общение с пользователем — на русском.** Комментарии в коде — на русском; имена идентификаторов, типов, файлов — на английском.
- **`src/sim/**` и `src/ecs/**` НЕ импортируют из `src/render`, `src/ui`, `src/input`, `three`.** Это проверяется ESLint-правилом `no-restricted-imports` (Task 1) и является критерием приёмки.
- **В `src/sim/**` и `src/ecs/**` запрещены `Math.random()` и `Date.now()`/`new Date()`** — только seeded RNG из `core/time`.
- Эталон поведения/визуала — `reference/earth-nuke.html`. Его НЕ менять.
- TypeScript strict: `strict: true`, `noUncheckedIndexedAccess: true`.
- Каждая задача заканчивается коммитом. Ветка разработки — `port` (создаётся в Task 1).

---

### Task 1: Скаффолдинг проекта

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`, `index.html`, `src/main.ts`, `src/vite-env.d.ts`
- Create: `vitest.setup.ts`

**Interfaces:**
- Produces: рабочие команды `npm run dev`, `npm run build`, `npm test`, `npm run lint`. Каталог `src/` с точкой входа `main.ts`.

- [ ] **Step 1: git init и ветка**

```bash
cd /Users/Gleb/war
git init
printf "node_modules/\ndist/\n.DS_Store\n*.log\n" > .gitignore
git add -A && git commit -m "chore: snapshot demo before architecture port"
git checkout -b port
```

- [ ] **Step 2: package.json**

Create `package.json`:

```json
{
  "name": "nuke-strategy",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . && prettier --check ."
  },
  "dependencies": {
    "three": "0.185.1",
    "miniplex": "2.0.0"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vite": "8.1.3",
    "vitest": "4.1.9",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "@types/three": "0.185.0"
  }
}
```

Run: `npm install`
Expected: `node_modules/` появился, ошибок нет.

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "test", "*.ts"]
}
```

- [ ] **Step 4: vite.config.ts + vitest.setup.ts**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
```

`vitest.setup.ts`:

```ts
// Место для будущих глобальных моков тестов. Пока пусто.
export {};
```

- [ ] **Step 5: ESLint с правилом границ модулей**

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts', 'src/ecs/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['three', 'three/*'], message: 'sim/ecs не зависят от рендера (three).' },
          { group: ['**/render/*', '**/ui/*', '**/input/*'], message: 'sim/ecs — чистые слои.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'Math', message: 'Используй seeded RNG из core/time (кроме чистой математики — тогда отдельные импорты).' },
      ],
    },
  },
);
```

> Примечание: правило `no-restricted-globals` на `Math` слишком широкое (Math.sin нужен в гео). Заменяем на точечный запрет только `Math.random`:

Замени блок `no-restricted-globals` на:

```js
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Только seeded RNG из core/time.' },
        { object: 'Date', property: 'now', message: 'Только часы из core/time.' },
      ],
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "semi": true, "printWidth": 100 }
```

- [ ] **Step 6: index.html + пустой main.ts**

`index.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>☢ Ядерная стратегия</title>
  <style>html,body{margin:0;height:100%;overflow:hidden;background:#1a2238}#scene{position:fixed;inset:0;display:block}</style>
</head>
<body>
  <canvas id="scene"></canvas>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`src/main.ts`:

```ts
// Точка входа. Пока лишь подтверждаем, что сборка и запуск работают.
const canvas = document.getElementById('scene') as HTMLCanvasElement;
console.log('boot', canvas.id);
```

- [ ] **Step 7: Проверка сборки и запуска**

Run: `npm run build`
Expected: `tsc --noEmit` без ошибок, `vite build` создаёт `dist/`.

Run: `npm run lint`
Expected: без ошибок.

Run: `npm test`
Expected: «No test files found» (или 0 тестов) — это нормально, упадения нет.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite+ts+eslint+vitest project"
```

---

### Task 2: core/time — seeded RNG и часы

**Files:**
- Create: `src/core/time.ts`
- Test: `test/core/time.test.ts`

**Interfaces:**
- Produces:
  - `TICK_HZ = 30`, `TICK_DT = 1 / 30` (число, секунды).
  - `class Rng { constructor(seed: number); next(): number /* [0,1) */; range(min: number, max: number): number; int(maxExclusive: number): number; }`
  - `now(): number` — монотонные секунды (обёртка `performance.now()/1000`), единственный разрешённый источник времени в рендере/цикле.

- [ ] **Step 1: Failing test**

`test/core/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Rng, TICK_DT } from '../../src/core/time';

describe('Rng', () => {
  it('детерминирован при одинаковом seed', () => {
    const a = new Rng(42), b = new Rng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });
  it('next() в диапазоне [0,1)', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('range и int работают', () => {
    const r = new Rng(7);
    const x = r.range(10, 20);
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThan(20);
    expect(Number.isInteger(r.int(5))).toBe(true);
  });
  it('TICK_DT = 1/30', () => {
    expect(TICK_DT).toBeCloseTo(1 / 30);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run test/core/time.test.ts`
Expected: FAIL (`Cannot find module '../../src/core/time'`).

- [ ] **Step 3: Implement**

`src/core/time.ts`:

```ts
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

// Детерминированный ГПСЧ (mulberry32) — воспроизводимость под реплеи и netcode.
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

// Единственный разрешённый источник времени в цикле/рендере.
export function now(): number {
  return performance.now() / 1000;
}
```

> `Math.random` не используется — только `Math.imul/floor` (чистая арифметика, ESLint-правило это разрешает).

- [ ] **Step 4: Verify pass**

Run: `npx vitest run test/core/time.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add src/core/time.ts test/core/time.test.ts
git commit -m "feat(core): seeded rng and tick constants"
```

---

### Task 2b: core/EventBus — типизированная шина событий

**Files:**
- Create: `src/core/EventBus.ts`
- Test: `test/core/EventBus.test.ts`

**Interfaces:**
- Produces: `class EventBus<E>` с `on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void`, `emit<K extends keyof E>(type: K, payload: E[K]): void`, `clear(): void`. Возвращаемая из `on` функция — отписка.

- [ ] **Step 1: Failing test**

`test/core/EventBus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

type Events = { hello: { n: number }; bye: void };

describe('EventBus', () => {
  it('доставляет событие подписчику', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    bus.on('hello', fn);
    bus.emit('hello', { n: 5 });
    expect(fn).toHaveBeenCalledWith({ n: 5 });
  });
  it('отписка прекращает доставку', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    const off = bus.on('hello', fn);
    off();
    bus.emit('hello', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run test/core/EventBus.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Implement**

`src/core/EventBus.ts`:

```ts
type Handler = (payload: unknown) => void;

// Типизированный pub/sub. Ключ E — карта {имяСобытия: типПейлоада}.
export class EventBus<E> {
  private handlers = new Map<keyof E, Set<Handler>>();

  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler);
    return () => set!.delete(fn as Handler);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run test/core/EventBus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/EventBus.ts test/core/EventBus.test.ts
git commit -m "feat(core): typed event bus"
```

---

### Task 3: sim/geo — проекции и тайл-математика

**Files:**
- Create: `src/sim/geo.ts`
- Test: `test/sim/geo.test.ts`

Порт из `reference/earth-nuke.html`: `lonLatToDir` (строки ~232–238), `latToTileYf`/`tileYfToLat` (~226–231), `MAX_MERC_LAT` (~204), UV-соглашение сферы. Тип вектора — свой лёгкий `Vec3` (НЕ three, иначе нарушим границы слоёв).

**Interfaces:**
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }`
  - `dot(a: Vec3, b: Vec3): number`, `angleBetween(a: Vec3, b: Vec3): number`
  - `lonLatToDir(lonRad: number, latRad: number): Vec3` — единичный вектор, ось-соглашение как в демо (`x=cosLat*cosLon, y=sinLat, z=-cosLat*sinLon`).
  - `MAX_MERC_LAT: number`
  - `latToTileYf(latRad: number, n: number): number`, `tileYfToLat(yf: number, n: number): number`

- [ ] **Step 1: Failing test**

`test/sim/geo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lonLatToDir, dot, angleBetween, latToTileYf, tileYfToLat, MAX_MERC_LAT } from '../../src/sim/geo';

describe('geo', () => {
  it('lonLatToDir даёт единичный вектор', () => {
    const v = lonLatToDir(0.5, 0.3);
    const len = Math.hypot(v.x, v.y, v.z);
    expect(len).toBeCloseTo(1, 6);
  });
  it('экватор, долгота 0 -> ось +x', () => {
    const v = lonLatToDir(0, 0);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });
  it('северный полюс -> +y', () => {
    const v = lonLatToDir(1.234, Math.PI / 2);
    expect(v.y).toBeCloseTo(1, 6);
  });
  it('angleBetween одинаковых точек = 0', () => {
    const v = lonLatToDir(0.2, 0.2);
    expect(angleBetween(v, v)).toBeCloseTo(0, 6);
    expect(dot(v, v)).toBeCloseTo(1, 6);
  });
  it('tile Y round-trip', () => {
    const n = 1 << 6;
    const lat = tileYfToLat(20.4, n);
    expect(latToTileYf(lat, n)).toBeCloseTo(20.4, 4);
  });
  it('MAX_MERC_LAT около 85.05°', () => {
    expect((MAX_MERC_LAT * 180) / Math.PI).toBeCloseTo(85.0511, 3);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run test/sim/geo.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Implement**

`src/sim/geo.ts`:

```ts
export type Vec3 = { x: number; y: number; z: number };

export const MAX_MERC_LAT = (85.05112878 * Math.PI) / 180;

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

// Соглашение осей идентично демо и UV-развёртке SphereGeometry three.js.
export function lonLatToDir(lonRad: number, latRad: number): Vec3 {
  const cl = Math.cos(latRad);
  return { x: cl * Math.cos(lonRad), y: Math.sin(latRad), z: -cl * Math.sin(lonRad) };
}

export function latToTileYf(latRad: number, n: number): number {
  const lat = clamp(latRad, -MAX_MERC_LAT, MAX_MERC_LAT);
  return ((1 - Math.log(Math.tan(lat / 2 + Math.PI / 4)) / Math.PI) / 2) * n;
}

export function tileYfToLat(yf: number, n: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * yf) / n)));
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run test/sim/geo.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/sim/geo.ts test/sim/geo.test.ts
git commit -m "feat(sim): geo projections and tile math"
```

---

### Task 4: Рендерер за интерфейсом + игровой цикл + пустая сцена

**Files:**
- Create: `src/render/Renderer.ts` (интерфейс + фабрика), `src/render/backend/createThreeRenderer.ts`
- Create: `src/core/GameLoop.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `now`, `TICK_DT` (core/time).
- Produces:
  - `interface Renderer { init(): Promise<void>; render(dt: number): void; resize(w: number, h: number): void; dispose(): void; readonly backend: 'webgpu' | 'webgl2'; readonly three: ThreeCtx; }`
  - `type ThreeCtx = { THREE: typeof import('three/webgpu'); scene: Scene; camera: PerspectiveCamera; renderer: WebGPURenderer }`
  - `createRenderer(canvas: HTMLCanvasElement): Renderer`
  - `class GameLoop { constructor(step: (dt: number) => void, render: (dt: number) => void); start(): void; stop(): void; }` — фиксированный таймстеп с аккумулятором.

- [ ] **Step 1: GameLoop (фиксированный шаг)**

`src/core/GameLoop.ts`:

```ts
import { now, TICK_DT } from './time';

// Фиксированный таймстеп для симуляции + свободный рендер. Аккумулятор гасит спайки.
export class GameLoop {
  private running = false;
  private last = 0;
  private acc = 0;
  private raf = 0;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (dt: number) => void,
  ) {}

  start(): void {
    this.running = true;
    this.last = now();
    const tick = () => {
      if (!this.running) return;
      const t = now();
      let frame = t - this.last;
      this.last = t;
      if (frame > 0.25) frame = 0.25; // защита от «дьявольской спирали»
      this.acc += frame;
      while (this.acc >= TICK_DT) {
        this.step(TICK_DT);
        this.acc -= TICK_DT;
      }
      this.render(frame);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
```

- [ ] **Step 2: Renderer интерфейс + бэкенд**

`src/render/backend/createThreeRenderer.ts`:

```ts
import * as THREE from 'three/webgpu';

export type ThreeCtx = {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer;
};

// WebGPURenderer сам берёт WebGPU, иначе откатывается на WebGL2-бэкенд.
export async function createThreeCtx(canvas: HTMLCanvasElement): Promise<ThreeCtx> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2238);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(0, 0, 3.2);

  return { THREE, scene, camera, renderer };
}

export function detectBackend(renderer: THREE.WebGPURenderer): 'webgpu' | 'webgl2' {
  return renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
}
```

`src/render/Renderer.ts`:

```ts
import { createThreeCtx, detectBackend, type ThreeCtx } from './backend/createThreeRenderer';

export type { ThreeCtx };

export interface Renderer {
  init(): Promise<void>;
  render(dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
  readonly backend: 'webgpu' | 'webgl2';
  readonly ctx: ThreeCtx;
}

class ThreeRenderer implements Renderer {
  private _ctx!: ThreeCtx;
  private _backend: 'webgpu' | 'webgl2' = 'webgl2';
  constructor(private canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    this._ctx = await createThreeCtx(this.canvas);
    this._backend = detectBackend(this._ctx.renderer);
    this.resize(window.innerWidth, window.innerHeight);
  }
  render(): void {
    this._ctx.renderer.render(this._ctx.scene, this._ctx.camera);
  }
  resize(w: number, h: number): void {
    this._ctx.renderer.setSize(w, h);
    this._ctx.camera.aspect = w / h;
    this._ctx.camera.updateProjectionMatrix();
  }
  dispose(): void {
    this._ctx.renderer.dispose();
  }
  get backend() {
    return this._backend;
  }
  get ctx() {
    return this._ctx;
  }
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  return new ThreeRenderer(canvas);
}
```

- [ ] **Step 3: main.ts — собрать цикл и пустую сцену со звёздами**

`src/main.ts`:

```ts
import { createRenderer } from './render/Renderer';
import { GameLoop } from './core/GameLoop';

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = createRenderer(canvas);
  await renderer.init();
  console.log('backend:', renderer.backend);

  const { THREE, scene } = renderer.ctx;
  // Звёзды — маркер того, что сцена рендерится.
  const positions = new Float32Array(2500 * 3);
  for (let i = 0; i < positions.length; i += 3) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 60);
    positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55 })));

  window.addEventListener('resize', () => renderer.resize(window.innerWidth, window.innerHeight));

  const loop = new GameLoop(
    () => {},                    // sim — появится позже
    () => renderer.render(0),
  );
  loop.start();
}

boot();
```

> Здесь `Math.random` в `main.ts` допустим — это рендер-слой, не sim. ESLint-правило действует только на `src/sim`/`src/ecs`.

- [ ] **Step 4: Проверка запуска (headless screenshot)**

Run:
```bash
npm run build
npx vite --port 5199 &   # dev-сервер (или npm run dev)
sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,800 --virtual-time-budget=6000 --screenshot=/tmp/step4.png "http://localhost:5199/"
kill %1
```
Expected: `/tmp/step4.png` — тёмно-синий фон со звёздами, без ошибок в консоли. `npm run build` без ошибок типов.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(render): renderer abstraction, fixed-step loop, blank scene"
```

---

### Task 5: Глобус + управление камерой (паритет вращения/зума)

**Files:**
- Create: `src/render/GlobeView.ts`, `src/input/CameraRig.ts`, `src/input/PointerController.ts`
- Create: `src/assets/config.ts`
- Modify: `src/main.ts`

Порт из демо: базовый глобус + атмосфера (строки ~104–140, 172–201), группы наклона/вращения и управление (`CameraRig`, pointer-обработчики ~660–700, зум ~ колесо, инерция и автоповорот из `animate`). Текстура Земли грузится из canvas (Blue Marble с фолбэком на процедурную — строки ~142–197).

**Interfaces:**
- Consumes: `ThreeCtx`.
- Produces:
  - `class GlobeView { constructor(ctx: ThreeCtx); readonly earthMesh: Mesh; readonly spinGroup: Group; readonly tiltGroup: Group; whenReady(): Promise<void>; }` (spin — вокруг Y, tilt — наклон X; earthMesh лежит в spinGroup).
  - `class CameraRig { constructor(ctx: ThreeCtx, globe: GlobeView); zoom: number; update(dt: number, pointerDown: boolean): void; rotateBy(dx: number, dy: number): void; }`
  - `class PointerController { constructor(canvas, ctx, globe, rig, onClickDir: (dir: Vec3) => void); }` — drag = вращение (через rig), клик = raycast по глобусу → `onClickDir(localDir)`.
  - `config.ts`: `YIELDS = [1,10,100]`, `TILE_IMAGERY_URL`, `TILE_LABELS_URL`, `EARTH_TEXTURE_URL`, `EARTH_TOPO_URL`, `TEX_W=4096`, `TEX_H=2048`.

- [ ] **Step 1: config.ts**

`src/assets/config.ts`:

```ts
export const TEX_W = 4096;
export const TEX_H = 2048;
export const YIELDS = [1, 10, 100] as const;
export type Yield = (typeof YIELDS)[number];

export const EARTH_TEXTURE_URL =
  'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
export const EARTH_TOPO_URL =
  'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';
export const TILE_IMAGERY_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const TILE_LABELS_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
```

- [ ] **Step 2: GlobeView (глобус, атмосфера, текстура)**

Создай `src/render/GlobeView.ts`, перенеся из `reference/earth-nuke.html`:
- сферу `earth` (радиус 1, 96×64), материал **`MeshPhongNodeMaterial`** из `three/webgpu` (вместо `MeshPhongMaterial`);
- атмосферу: в WebGPU шейдер задаётся через TSL. Для паритета допустимо на этом шаге временно использовать backside-сферу с `MeshBasicNodeMaterial` цвета `0x35558f`, `AdditiveBlending`, `opacity 0.15` — точную fresnel-версию доведём в Task 9 (визуальная полировка). Отметить `// TODO(parity): fresnel через TSL` НЕЛЬЗЯ оставлять без реализации — поэтому сразу делаем fresnel на TSL:

```ts
import { positionWorld, cameraPosition, normalWorld, dot, sub, normalize, pow, oneMinus, abs, vec4, float } from 'three/tsl';
// rim = pow(1 - |dot(N, viewDir)|, 4.5) * 0.55
const viewDir = normalize(sub(cameraPosition, positionWorld));
const rim = pow(oneMinus(abs(dot(normalWorld, viewDir))), float(4.5)).mul(0.55);
atmoMaterial.colorNode = vec4(0.35, 0.55, 1.0, 1.0).mul(rim);
atmoMaterial.transparent = true;
atmoMaterial.blending = THREE.AdditiveBlending;
atmoMaterial.side = THREE.BackSide;
atmoMaterial.depthWrite = false;
```

- текстуру Земли грузи в `<canvas>` (Blue Marble, `crossOrigin='anonymous'`; при ошибке/таймауте 15с — процедурный фолбэк, порт строк ~142–167), заворачивай в `CanvasTexture`, ставь на `earthMaterial.colorNode` через `texture(canvasTex)` из `three/tsl` или проще `earthMaterial.map = canvasTex`.
- группы: `tiltGroup` → `spinGroup` → `earth` + `atmo`; `scene.add(tiltGroup)`.
- `whenReady()` резолвится, когда текстура (или фолбэк) готова.

Освещение сцены (в main или GlobeView): один `DirectionalLight(0xffffff, 2.8)` на `(5,2,3)` + `AmbientLight(0x8899aa, 1.5)` — как в демо. **Больше никаких источников света не добавляем никогда.**

- [ ] **Step 3: CameraRig (зум, инерция, автоповорот)**

`src/input/CameraRig.ts` — перенеси логику из `animate()` демо: `zoom` (clamp 1.05..7), инерция `velX/velY *= 0.93`, автоповорот при простое >3с и `zoom>2` (`spinGroup.rotation.y += dt*0.04`), наклон clamp ±1.45. `update(dt, pointerDown)` двигает камеру на `z = zoom` и `camera.lookAt(0,0,0)` (тряску добавим в Task 8). `rotateBy(dx,dy)` крутит `spinGroup.rotation.y` и `tiltGroup.rotation.x` со скоростью `0.0045 * clamp((zoom-1)/2.2, 0.02, 1)`.

- [ ] **Step 4: PointerController (drag/zoom/click)**

`src/input/PointerController.ts` — порт pointer-обработчиков демо: `pointerdown/move/up`, порог drag 5px, `wheel` → `rig.zoom`. На клике (без drag): raycast `Raycaster` из `ctx.camera` по `globe.earthMesh`; при попадании перевести `hit.point` в локальные коорд. earth (`earth.worldToLocal`), нормализовать → вызвать `onClickDir({x,y,z})`. Зум — `e.preventDefault()`, `passive:false`.

- [ ] **Step 5: Собрать в main.ts**

Замени тело `boot()` после создания рендерера: создать `GlobeView`, `await globe.whenReady()`, `CameraRig`, `PointerController` (пока `onClickDir` логирует). В цикле: `rig.update(frame, pointerController.isDown)` перед `renderer.render`.

- [ ] **Step 6: Проверка (screenshot + типы)**

Run:
```bash
npm run build && npx vite --port 5199 &
sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,800 --virtual-time-budget=8000 --screenshot=/tmp/step5.png "http://localhost:5199/"
kill %1
```
Expected: `/tmp/step5.png` — Земля с текстурой Blue Marble, тонкой атмосферой, звёздами. `npm run build` без ошибок. Ручная проверка (dev): планета крутится мышью, зумится колесом, клик пишет вектор в консоль.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(render): globe, atmosphere (TSL fresnel), camera rig, pointer control"
```

---

### Task 6: Тайлы — снимки + границы/названия

**Files:**
- Create: `src/render/TileLayers.ts`
- Modify: `src/main.ts`, `src/ui/Hud.ts` (кнопка появится в Task 10; пока переключатель — временно клавишей или всегда вкл)

Полный порт системы тайлов из демо (строки ~204–330): два слоя (`imagery` активен при `zoom-1 <= 1.2`, `labels` активен всегда), геометрия тайла как изогнутый патч, выбор LOD по дистанции, отбор по углу видимой области (raycast по углам экрана), пул мешей, LRU-кэш ~400, оставление старого уровня подложкой до догрузки нового.

**Interfaces:**
- Consumes: `ThreeCtx`, `GlobeView` (spinGroup, earthMesh), `CameraRig` (zoom), `config`.
- Produces: `class TileLayers { constructor(ctx, globe, rig); update(): void; setLabelsEnabled(v: boolean): void; readonly meshCount: number; }`. `update()` вызывать в цикле раз в ~0.3с.

- [ ] **Step 1: Порт TileLayers**

Перенеси код слоёв. Материалы: `imagery` → `MeshPhongNodeMaterial{ map }`, `labels` → `MeshBasicNodeMaterial{ map, transparent:true, depthWrite:false }`. `TextureLoader` из `three/webgpu`. `overlayGroup` (labels) чуть выше `tilesGroup` (`rOff=0.0009`). Загрузка тайла: `crossOrigin='anonymous'`, `colorSpace=SRGBColorSpace`, `anisotropy`.

- [ ] **Step 2: Вызов из цикла**

В `main.ts`: создать `TileLayers`, в render-колбэке аккумулировать время и вызывать `tiles.update()` каждые 0.3с. Клавиша `L` временно дергает `setLabelsEnabled` (постоянную кнопку добавит Hud в Task 10).

- [ ] **Step 3: Проверка (screenshot зума)**

Добавь временный хук `window.__setZoom = (v)=>rig.zoom=v`. Скриптом: выставить zoom≈1.15, подождать, скриншот.
```bash
npm run build && npx vite --port 5199 &
sleep 3
cat > /tmp/probe.js <<'EOF'
setTimeout(()=>{ window.__setZoom(1.15); }, 4000);
EOF
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,800 --virtual-time-budget=15000 --screenshot=/tmp/step6.png "http://localhost:5199/"
kill %1
```
Expected: `/tmp/step6.png` — спутниковые тайлы вблизи + подписи стран/городов поверх (сравнить с демо-скриншотом).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(render): satellite + labels tile streaming"
```

---

### Task 7: Симуляция — города, ECS, команды/события, расчёт жертв

**Files:**
- Create: `src/sim/cities.ts`, `src/sim/commands.ts`, `src/sim/events.ts`, `src/sim/Simulation.ts`, `src/sim/SimHost.ts`
- Create: `src/ecs/world.ts`, `src/ecs/components.ts`, `src/ecs/systems/CasualtySystem.ts`
- Test: `test/sim/casualty.test.ts`, `test/sim/simulation.test.ts`

**Interfaces:**
- Consumes: `Rng`, `TICK_DT` (core/time), `geo`.
- Produces:
  - `cities.ts`: `type City = { name: string; pop: number; alive: number; dir: Vec3 }`; `createCities(): City[]` (порт массива `CITY_DATA` из демо ~332–420 **дословно**, конвертация градусов→радианы через `lonLatToDir`).
  - `commands.ts`: `type Command = { kind: 'detonate'; dir: Vec3; yield: number } | { kind: 'setYield'; yield: number } | { kind: 'reset' } | { kind: 'toggleLabels' }`.
  - `events.ts`: `type SimEvent = | { kind: 'missileLaunched'; id: number; dir: Vec3; yield: number } | { kind: 'explosionStarted'; id: number; dir: Vec3; yield: number; seed: number } | { kind: 'cityHit'; name: string; deaths: number; atWaveTime: number } | { kind: 'planetReset' } | { kind: 'statsChanged'; bombs: number; megatons: number; deaths: number } | { kind: 'labelsToggled'; enabled: boolean }`.
  - `computeCasualties(cities: City[], dir: Vec3, yieldMt: number, ts: number): { hits: {name:string; deaths:number; atWaveTime:number}[]; totalDeaths: number }` — чистая функция (см. формулу ниже).
  - `class Simulation { constructor(seed: number); step(dt: number, commands: Command[]): SimEvent[]; snapshot(): unknown; }`.
  - `interface SimHost { post(cmd: Command): void; drainEvents(): SimEvent[]; step(dt: number): void; }` + `class LocalSimHost implements SimHost`.

Формула жертв (порт из демо ~798–812, вынести в чистую функцию):
```
angPatch = {1:0.05,10:0.082,100:0.14}[yield]
ts       = {1:0.8, 10:1.0, 100:1.4}[yield]
waveMaxAng = 0.45 * ({1:0.6,10:1.0,100:1.7}[yield])
для каждого города c с c.alive>0.001:
  d = angleBetween(c.dir, dir)
  если d > angPatch: пропустить
  frac = d <= angPatch*0.4 ? 1 : 1 - ((d - angPatch*0.4)/(angPatch*0.6))*0.95
  deaths = c.alive * frac;  c.alive -= deaths
  q = min(1, d / waveMaxAng)
  atWaveTime = 12 * (1 - (1-q)^(1/1.8)) * ts
```

- [ ] **Step 1: Failing test для computeCasualties**

`test/sim/casualty.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCities } from '../../src/sim/cities';
import { computeCasualties } from '../../src/ecs/systems/CasualtySystem';
import { lonLatToDir } from '../../src/sim/geo';

const moscow = lonLatToDir((37.62 * Math.PI) / 180, (55.75 * Math.PI) / 180);

describe('computeCasualties', () => {
  it('прямое попадание по Москве убивает ~всё население города', () => {
    const cities = createCities();
    const before = cities.find((c) => c.name === 'Moscow')!.alive;
    const { hits, totalDeaths } = computeCasualties(cities, moscow, 100, 1.4);
    const mos = hits.find((h) => h.name === 'Moscow')!;
    expect(mos.deaths).toBeGreaterThan(before * 0.9);
    expect(totalDeaths).toBeGreaterThan(mos.deaths);
    expect(mos.atWaveTime).toBeGreaterThanOrEqual(0);
  });
  it('повторный удар не убивает уже погибших', () => {
    const cities = createCities();
    computeCasualties(cities, moscow, 100, 1.4);
    const second = computeCasualties(cities, moscow, 100, 1.4);
    const mos = second.hits.find((h) => h.name === 'Moscow');
    expect(mos === undefined || mos.deaths < 0.05).toBe(true);
  });
  it('удар в океан (0N,0E) никого не задевает', () => {
    const cities = createCities();
    const { totalDeaths } = computeCasualties(cities, lonLatToDir(0, 0), 1, 0.8);
    expect(totalDeaths).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run test/sim/casualty.test.ts`
Expected: FAIL (модули не найдены).

- [ ] **Step 3: Implement cities + CasualtySystem**

- `src/sim/cities.ts`: перенеси массив `CITY_DATA` из демо **дословно** (это данные, не логика — копировать целиком, ~220 строк). `createCities()` мапит `[name,lat,lon,pop]` → `{name,pop,alive:pop,dir:lonLatToDir(lon°→rad, lat°→rad)}`.
- `src/ecs/systems/CasualtySystem.ts`: экспортируй чистую `computeCasualties(...)` по формуле выше (используй `angleBetween` из geo). Таблицы `angPatch/ts/ys` — как объекты-константы.

- [ ] **Step 4: Verify pass (casualty)**

Run: `npx vitest run test/sim/casualty.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: ECS world, components, Simulation, SimHost**

- `src/ecs/world.ts`: `import { World } from 'miniplex'`; `type Entity = { onSphere?: Vec3; warhead?: {yield:number; seed:number; t:number; flightTime:number; dir:Vec3}; blast?: {age:number; yield:number; seed:number; ts:number} }`; `export const createWorld = () => new World<Entity>()`.
- `src/ecs/components.ts`: типы компонентов (переиспользуй из world или вынеси сюда, импортируй в world).
- `src/sim/Simulation.ts`: держит `World`, `Rng`, массив `cities`, счётчики `bombs/megatons/totalDeaths`, счётчик `nextId`. `step(dt, commands)`:
  1. применить команды: `detonate` → добавить сущность `warhead` (flightTime=2.6, t=0, seed=rng.int(1e9)), эмитнуть `missileLaunched`; `setYield`/`reset`/`toggleLabels` — обновить состояние/эмитнуть события (`reset` воскрешает города: `alive=pop`, эмитит `planetReset`+`statsChanged`).
  2. `MissileSystem` (здесь же или отдельно в Task 8): продвинуть `warhead.t += dt`; при `t>=flightTime` — удалить сущность, посчитать `computeCasualties`, применить к `cities`, эмитнуть `explosionStarted` + по каждому городу `cityHit`, обновить счётчики, эмитнуть `statsChanged`.
  3. вернуть накопленные события.
- `src/sim/SimHost.ts`: `LocalSimHost` буферизует команды, на `step(dt)` вызывает `sim.step(dt, buffered)` и складывает события; `drainEvents()` отдаёт и чистит.

- [ ] **Step 6: Failing test для Simulation**

`test/sim/simulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { lonLatToDir } from '../../src/sim/geo';
import { TICK_DT } from '../../src/core/time';

describe('Simulation', () => {
  it('detonate рождает missileLaunched, затем explosionStarted после полёта', () => {
    const sim = new Simulation(123);
    const dir = lonLatToDir((37.62 * Math.PI) / 180, (55.75 * Math.PI) / 180);
    let ev = sim.step(TICK_DT, [{ kind: 'detonate', dir, yield: 10 }]);
    expect(ev.some((e) => e.kind === 'missileLaunched')).toBe(true);
    // прогоняем ~3 секунды (полёт 2.6с)
    let exploded = false;
    for (let i = 0; i < 100; i++) {
      ev = sim.step(TICK_DT, []);
      if (ev.some((e) => e.kind === 'explosionStarted')) exploded = true;
    }
    expect(exploded).toBe(true);
  });
  it('детерминизм: одинаковый seed и команды -> одинаковые события', () => {
    const run = () => {
      const sim = new Simulation(7);
      const dir = lonLatToDir(0.5, 0.5);
      const out: string[] = [];
      let cmds = [{ kind: 'detonate', dir, yield: 100 } as const];
      for (let i = 0; i < 120; i++) {
        for (const e of sim.step(TICK_DT, cmds)) out.push(e.kind + (e.kind === 'cityHit' ? ':' + e.name : ''));
        cmds = [];
      }
      return out.join('|');
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 7: Verify pass**

Run: `npx vitest run test/sim/`
Expected: PASS (все тесты sim).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sim): ecs world, cities, commands/events, casualty, simulation+simhost"
```

---

### Task 8: Ракета — модель, полёт, тряска (интеграция sim↔render)

**Files:**
- Create: `src/render/MissileView.ts`, `src/render/Scene.ts`
- Modify: `src/main.ts`, `src/input/CameraRig.ts` (добавить `shake`)

`Scene` — мост: подписывается на события `SimHost` и отражает их в трёх-объектах. `MissileView` — процедурная модель МБР (порт `buildMissileModel` демо ~672–720) в пуле; на `missileLaunched` берёт из пула, летит по `t/flightTime` (читая состояние через событие + локальную интерполяцию), на `explosionStarted` прячет обратно.

**Interfaces:**
- Consumes: `SimHost` events, `ThreeCtx`, `GlobeView.spinGroup`, `geo.Vec3`.
- Produces: `class Scene { constructor(ctx, globe, host: SimHost); update(dt: number): void; }` (владеет MissileView/ExplosionView/DecalView — последние добавятся в Task 9–10); `class MissileView { spawn(id, dir, yieldMt): void; update(dt): void; }` с внутренним пулом (без аллокаций после прогрева).

- [ ] **Step 1: MissileView с пулом**

Перенеси `buildMissileModel` (боеголовка/ступени/стабилизаторы/факел) в `MissileView`. Материалы — `MeshPhongNodeMaterial`/`MeshBasicNodeMaterial`. Пул: предсоздать 8 моделей, `spawn` активирует, `update` двигает по дуге (radius `2.6→1.0` по `k*k`, `group.lookAt(центр)`, вращение `model.rotation.z += dt*1.5`, дрожь факела). Ракета живёт `flightTime=2.6`с, потом прячется.

- [ ] **Step 2: Scene-мост**

`Scene` подписывается: `missileLaunched` → `missileView.spawn`; хранит время каждого снаряда, прячет по истечении. `update(dt)` двигает вьюхи. Тряску камеры (`CameraRig.shake`) заводим на `explosionStarted` (в Task 10 усилим).

- [ ] **Step 3: Провод в main**

Клик `PointerController.onClickDir` → `host.post({kind:'detonate', dir, yield: currentYield})`. Цикл: `host.step(TICK_DT)` в sim-колбэке `GameLoop`; в render-колбэке — `scene.update(frame)` + `rig.update`. События из `host.drainEvents()` прокидывать в `scene` и (позже) в `Hud`.

- [ ] **Step 4: Проверка (screenshot полёта)**

Хук `window.__strike=()=>host.post({kind:'detonate', dir: <центр экрана>, yield:10})` или синтетический клик. Скриншот через ~0.8с после удара — ракета в полёте с факелом.
Expected: `/tmp/step8.png` — узнаваемая ракета (не стрелка) летит к поверхности. `npm run build` без ошибок.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(render): pooled missile model, sim-render scene bridge"
```

---

### Task 9: Взрыв — GPU-инстансированные частицы (TSL), огненный шар, ударная волна

**Files:**
- Create: `src/render/ExplosionView.ts`, `src/render/effects/particles.ts`
- Modify: `src/render/Scene.ts`

Ключевая задача производительности. Вместо ~150 `Sprite` на взрыв — **один инстанс-меш на всю сцену**, частицы позиционируются в вершинном шейдере (TSL) по своим инстанс-атрибутам и общему `uTime`. Огненный шар и ударная волна — по одному мешу на активный взрыв (их мало и они дёшевы), из пула. **Динамического света нет.**

**Interfaces:**
- Consumes: `ThreeCtx`, `GlobeView.spinGroup`, события `explosionStarted`.
- Produces: `class ExplosionView { spawn(dir: Vec3, yieldMt: number, seed: number): void; update(dt: number): void; }`; `class ParticlePool { constructor(ctx, capacity: number); emit(origin, basis, params): void; setTime(t): void; }`.

- [ ] **Step 1: ParticlePool на инстансах + TSL**

`src/render/effects/particles.ts`: один `THREE.InstancedMesh`(quad) или `THREE.Sprite`-инстансинг через `SpriteNodeMaterial`. Инстанс-атрибуты (InstancedBufferAttribute): `aSpawn` (время рождения), `aSeed`, `aDir` (нормаль эпицентра, vec3), `aParams` (тип/размер/жизнь/угол упаковкой). Позиция считается в TSL из `uTime - aSpawn`:

```ts
import { Fn, instancedBufferAttribute, uniform, positionLocal, vec3, float, mix, clamp } from 'three/tsl';
import { SpriteNodeMaterial } from 'three/webgpu';

// uTime — общий, обновляется раз за кадр
const uTime = uniform(0);
const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
// aSpawn, aSeed, aDir, aParams — instancedBufferAttribute(...)
// life-progress lk = clamp((uTime - aSpawn)/aLife, 0, 1)
// rise = 1-(1-lk)^2; смещение вдоль нормали + касательных из aDir; масштаб и opacity по lk
mat.positionNode = /* TSL-выражение мировой позиции частицы (гриб: ножка+шляпка) */;
mat.scaleNode = /* размер по прогрессу */;
mat.opacityNode = /* fadeIn * (fire?0.85:0.65) * (1-lk) */;
mat.colorNode = /* mix(огонь: жёлтый→красный; дым: серый→тёмный) по lk */;
```

`emit()` записывает в кольцевой буфер инстансов (capacity, напр., 4000) параметры пачки частиц одного взрыва (ножка/шляпка/дым — распределение из демо ~842–888, но как данные атрибутов, без JS-объектов на кадр). `setTime(t)` пишет `uTime`. Ничего не аллоцируется на кадр — только запись в существующие типизированные массивы + `needsUpdate`.

> Реализация positionNode: перенеси кривые из демо (`h0..h1`, `spread`, касательный базис из нормали) в TSL-узлы. Базис (t1,t2) можно передать в `aParams`/доп.атрибутах или вычислить в шейдере из `aDir`.

- [ ] **Step 2: Огненный шар + ударная волна (TSL, из пула)**

В `ExplosionView`: пул из ~6 огненных шаров (сфера, `MeshBasicNodeMaterial` additive, `colorNode` с fresnel-ядром — порт шейдера демо ~758–781) и ~6 мешей ударной волны (изогнутый купол `makeShockwaveGeometry` ~470–495, TSL-фрагмент фронта по `uR` — порт ~815–840). На `spawn` берём из пула, гоним таймлайн (`totalLife = 28*ts`, тайминги ~890–933), по завершении возвращаем в пул. Тряска: выставить `rig.shake`.

- [ ] **Step 3: Подписка Scene**

`Scene` на `explosionStarted` → `explosionView.spawn(dir, yield, seed)` + `particlePool.emit(...)`. В `update` — `explosionView.update(dt)` и `particlePool.setTime(now)`.

- [ ] **Step 4: Проверка (screenshot взрыва + отсутствие лагов)**

Скриншот на ~8-й секунде взрыва 100 Мт (fireball + волна + гриб). Затем стресс: 12 ударов подряд, замерить FPS в консоли (счётчик кадров).
```bash
# в probe: 12 раз window.__strike с интервалом 150мс; логировать среднее время кадра
```
Expected: `/tmp/step9.png` похож на демо-взрыв; среднее время кадра при 12 одновременных взрывах **< 20 мс** (нет подвисаний), в консоли нет перекомпиляций шейдеров.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "perf(render): instanced TSL explosion particles, pooled fireball+shockwave, no dynamic lights"
```

---

### Task 10: Кратеры-декали + HUD + приёмка

**Files:**
- Create: `src/render/DecalView.ts`, `src/ui/Hud.ts`, `src/ui/styles.css`
- Modify: `src/render/Scene.ts`, `src/main.ts`, `index.html`

Кратеры — декали-патчи (порт `makePatchGeometry` ~430–460 + `makeCraterTexture` ~497–530) в пуле с лимитом 512 (старые переиспользуются), раскалённая кайма — additive-декаль, остывает 50с (порт `updateGlows` ~535–555). HUD — DOM: счётчики (бомбы/мегатонны/жертвы), лента поражённых городов, кнопки мощности (1/10/100), «Восстановить планету», «Границы и названия: вкл/выкл».

**Interfaces:**
- Consumes: `SimHost` (post команды из кнопок), события `explosionStarted`/`cityHit`/`statsChanged`/`planetReset`/`labelsToggled`.
- Produces: `class DecalView { spawn(dir, yieldMt, seed): void; update(dt): void; clear(): void; }`; `class Hud { constructor(host: SimHost); onEvent(e: SimEvent): void; }`.

- [ ] **Step 1: DecalView (пул + лимит 512)**

Перенеси генерацию патча/текстуры кратера и glow. Пул кратеров 512: при переполнении переиспользовать самый старый. Glow — отдельный additive-меш, `opacity` гаснет по возрасту (0..50с), цвет `hot→cold`. `spawn` на `explosionStarted`. `clear()` на `planetReset`.

- [ ] **Step 2: Hud (DOM)**

Порт разметки/стилей из демо (панель, кнопки, лента, анимация `feedIn`) в `src/ui/Hud.ts` + `styles.css` (импортировать в main). Кнопки мощности → `host.post({kind:'setYield'})` + визуальное активное состояние; «Восстановить» → `{kind:'reset'}`; «Границы» → `{kind:'toggleLabels'}`. `onEvent`: `statsChanged` → обновить счётчики (формат `fmtPeople` — порт); `cityHit` → добавить строку в ленту в момент прихода волны (Scene/Hud учитывает `atWaveTime` относительно локального времени взрыва — Hud получает `cityHit` сразу, но показывает с задержкой `atWaveTime`, планируя через таймер от `explosionStarted`); `planetReset` → очистить ленту.

> Синхронизация задержки: на `explosionStarted` запомнить `t0`; входящие `cityHit` показывать через `setTimeout(atWaveTime*1000)` (или планировщик на игровых часах). Это сохраняет эффект «города гаснут по мере прихода волны».

- [ ] **Step 3: Звук взрыва (WebAudio)**

Перенеси `boomSound` (порт ~558–595) в `src/render/effects/sound.ts`; вызывать из `ExplosionView` на `spawn` (после первого пользовательского жеста — как в демо, `ensureAudio` на `pointerdown`).

- [ ] **Step 4: Финальная приёмка (все критерии спеки)**

```bash
npm run lint      # границы модулей соблюдены
npm test          # вся логика зелёная
npm run build     # типы ок, прод-сборка ок
```
Затем headless-скриншоты сравнить с демо по состояниям: (1) глобус, (2) зум+тайлы+подписи, (3) полёт ракеты, (4) взрыв 100 Мт, (5) кратер после, (6) счётчик жертв/лента после удара по Москве. Стресс: 15 ударов подряд — среднее время кадра < 20 мс, нет подвисаний.

Проверить оба бэкенда: запустить обычный Chrome (WebGPU) и headless swiftshader (WebGL2) — оба без ошибок консоли, `console.log('backend:')` показывает соответствующий бэкенд.

- [ ] **Step 5: Обновить банк памяти и слить ветку**

Обнови `memory-bank/progress.md` (этап 1 завершён, перечисли что портировано) и `memory-bank/activeContext.md` (следующий фокус — бэклог). Коммит и мёрж:

```bash
git add -A && git commit -m "feat: craters (pooled/capped), HUD, sound; parity acceptance"
git checkout main 2>/dev/null || git checkout -b main
git merge --no-ff port -m "Этап 1: порт демо на архитектуру (Vite+TS+ECS+WebGPU)"
```

---

## Self-Review (выполнено при написании плана)

**Покрытие спеки:** каждый модуль из таблицы спеки имеет задачу — core/time (T2), EventBus (T2b), Renderer+GameLoop (T4), GlobeView/CameraRig/PointerController (T5), TileLayers (T6), sim/ecs/cities/commands/events/Simulation/SimHost/CasualtySystem (T7), MissileSystem+MissileView+Scene (T8), ExplosionView/particles (T9), DecalView/Hud/config (T5,T10). Критерии приёмки → T10 Step 4. Границы модулей → ESLint (T1) + приёмка. Оба бэкенда → T4/T10.

**Плейсхолдеры:** TSL-выражения в T9 Step 1 намеренно оставлены как узловые формулы с точными ссылками на строки демо-источника — это перевод известной математики в TSL, не «додумай сам»; исходные кривые лежат в `reference/earth-nuke.html` по указанным строкам. Данные городов (T7) копируются дословно из источника. Прочие шаги содержат полный код.

**Согласованность типов:** `Vec3` из `sim/geo` используется сквозно (sim/ecs — как есть; render конвертит в `THREE.Vector3` на границе). `SimEvent`/`Command` едины в T7 и потребляются в T8/T10. `SimHost` (`post`/`step`/`drainEvents`) согласован между T7 (определение) и T8/T10 (использование). `ExplosionView.spawn(dir,yield,seed)` и `DecalView.spawn(dir,yield,seed)` — одинаковая сигнатура.
