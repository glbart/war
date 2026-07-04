# Спека этапа 1 — перенос демо на архитектуру

Дата: 2026-07-04. Дизайн одобрен пользователем в диалоге (Vite+TS, ECS/miniplex, WebGPU+откат, TSL).
Контекст проекта и решения — в `memory-bank/` (особенно `systemPatterns.md`).

## Цель

Воспроизвести всю функциональность демо `reference/earth-nuke.html` на новой архитектуре
(Vite + TypeScript + ECS/miniplex + WebGPU-рендерер с откатом на WebGL2), устранив лаги при частых
ударах. **Новых игровых фич не добавляем** — этап доказывает, что каркас верный.

## Критерии приёмки

1. `npm run dev` поднимает игру; визуал и поведение совпадают с демо (проверка скриншотами
   headless Chrome по ключевым состояниям: глобус, зум с тайлами, слой границ/подписей, полёт
   ракеты, кадр взрыва, кратер, счётчик жертв/лента).
2. **Серия из 10+ быстрых ударов не вызывает подвисаний** (нет per-взрыв аллокаций и динамического
   света; частицы инстансированы).
3. `npm test` зелёный: юнит-тесты чистой логики (гео, расчёт жертв, системы).
4. `sim` и `ecs` не импортируют `render`/`ui`/`input` (проверяемо ESLint-правилом на границы).
5. WebGPU-путь и откат на WebGL2 оба запускаются без ошибок консоли.

## Архитектурные инварианты

- **Шов Command → Simulation → Events.** Ввод порождает `Command`; симуляция — единственный мутатор,
  выпускает `Events`; рендер и UI только читают. Реализация симуляции скрыта за интерфейсом
  `SimHost` (`postCommand`, `onEvent`, `snapshot`), на этом этапе — `LocalSimHost` в основном потоке.
- **Фиксированный таймстеп** 30 Гц (аккумулятор), рендер интерполирует. **Seeded RNG** в `core/time`;
  в `sim`/`ecs` запрещён `Math.random()` и `Date.now()`.
- **Направление зависимостей:** `core` ← `sim`/`ecs` ← (`render`, `ui`, `input`) ← `main`.

## Модули и ответственность

| Модуль | Ответственность |
|--------|-----------------|
| `core/GameLoop` | цикл: фикс-таймстеп для sim + рендер с интерполяцией |
| `core/EventBus` | типизированный pub/sub событий sim → render/ui |
| `core/time` | seeded RNG, часы, таймстеп-константы |
| `sim/Simulation` | владеет ECS-миром и системами; `step(dt, commands) → events`; `snapshot()` |
| `sim/SimHost` | интерфейс + `LocalSimHost` |
| `sim/commands`, `sim/events` | типы команд и событий |
| `sim/geo` | lat/lon ↔ единичный вектор, тайл-математика (Web Mercator) |
| `sim/cities` | датасет ~220 агломераций |
| `ecs/world` | обёртка miniplex |
| `ecs/components` | `OnSphere{dir}`, `Warhead{yield,seed,t}`, `Blast{age,yield,seed}`, `City{name,pop,alive}` |
| `ecs/systems` | `MissileSystem`, `ExplosionSystem`, `CasualtySystem` |
| `render/Renderer` | интерфейс `init/resize/render/dispose/capabilities` |
| `render/backend/createRenderer` | WebGPURenderer + автооткат на WebGL2 |
| `render/Scene` | граф сцены, маппинг ECS-сущностей → view-объекты |
| `render/GlobeView` | базовый глобус, атмосфера, звёзды |
| `render/TileLayers` | стриминг тайлов (снимки + границы/подписи), пул мешей, лимит загрузок |
| `render/ExplosionView` | инстанс-частицы (TSL), огненный шар, ударная волна; из пула |
| `render/DecalView` | кратеры и раскалённая кайма; пул + лимит ~512 |
| `input/PointerController` | drag-rotate, зум, клик→raycast→`DetonateCommand` |
| `input/CameraRig` | tilt/spin-группы, инерция, автоповорот, состояние зума |
| `ui/Hud` | счётчики, лента, кнопки; шлёт команды; читает события |
| `assets/config` | мощности зарядов, URL тайлов, константы тюнинга |

## Команды и события (для паритета)

- Commands: `DetonateCommand{dir, yield}`, `ResetPlanetCommand`, `SetYieldCommand{yield}`,
  `ToggleLabelsCommand`.
- Events: `MissileLaunched{id, dir, yield}`, `ExplosionStarted{dir, yield, seed}`,
  `CityHit{name, deaths, atWaveTime}`, `PlanetReset`,
  `StatsChanged{bombs, megatons, deaths}`.
- Анимация ударной волны не порождает событий на кадр: `ExplosionView` целиком проигрывает её из
  одного `ExplosionStarted` по локальному времени эффекта. `CasualtySystem` считает `atWaveTime`
  (момент прихода фронта в город) в симуляции и кладёт его в `CityHit` — HUD показывает жертву,
  когда время эффекта достигает `atWaveTime`.

Расчёт жертв (перенос из демо): город в зоне поражения гибнет по фракции от расстояния до
эпицентра (в центре 100%, к краю ~5%); жертвы засчитываются в момент прихода фронта волны;
повторный удар учитывает выжившее население.

## Рендер-конвейер и оптимизации

- Частицы взрыва — **один инстанс-меш на тип эффекта**; позиция частицы вычисляется в вершинном
  шейдере (TSL) из `(spawnTime, seed, params)`. Ноль JS-объектов на частицу, ноль CPU-работы на кадр.
- **Никакого динамического света** — вспышка через additive/bloom; один статический «солнечный» свет.
- **Пулинг** взрывов/ракет/декалей; **лимит декалей** ~512 (старые переиспользуются).
- Тайлы — пул мешей, ограничение числа одновременных загрузок, LRU-кэш текстур (как в демо).

## Тестирование

- **Vitest** (headless): `sim/geo` (проекции, шов долготы, полюса), `CasualtySystem` (фракции,
  повторный удар, воскрешение при reset), детерминизм шага при seeded RNG.
- **Рендер**: headless Chrome + скриншоты ключевых состояний, сравнение с демо на глаз.
- **Границы модулей**: ESLint-правило (`no-restricted-imports`) запрещает импорт render/ui/input
  из sim/ecs.

## Порядок работ (вертикальными срезами)

1. Скаффолдинг: `git init`, npm, Vite, tsconfig (strict), ESLint+Prettier, Vitest, пустой рендер-цикл.
2. `core` (loop, event bus, time) + `render` минимальный (пустая сцена на WebGPU/WebGL2).
3. `GlobeView` + `CameraRig`/`PointerController` — вращаемый глобус (паритет управления).
4. `TileLayers` — снимки и слой границ/подписей.
5. `sim`/`ecs`: гео, города; команды/события; `MissileSystem` + модель ракеты.
6. `ExplosionSystem` + `ExplosionView` (инстанс-частицы, волна, шар) — оптимизированный взрыв.
7. `DecalView` (кратеры) + `CasualtySystem` + `Hud` (счётчики, лента, кнопки).
8. Проверка критериев приёмки; замер отсутствия лагов на серии ударов.

## Вне скоупа этапа 1

Онлайн/сеть, Web Worker для симуляции, страны/фракции, миссии, радиация/ядерная зима,
день-ночь терминатор, мобильное управление, экран итогов. Всё это — бэклог (`progress.md`).
