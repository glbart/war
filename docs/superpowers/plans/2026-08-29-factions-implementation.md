# Страны и фракции — план реализации

**Спека:** `docs/superpowers/specs/2026-08-29-factions-design.md`
**Ветка:** `claude/upcoming-features-status-rnx8r3`

**Цель:** город принадлежит стороне; у стороны — население и арсенал; залп идёт из страны
по стране и тратит боеголовки; всё это видно в HUD и на глобусе.

## Ограничения

- Комментарии и общение — на русском (CLAUDE.md).
- Детерминизм симуляции: только `Rng`, никакого `Math.random` в sim.
- Ноль работы CPU на кадр в рендере: маркеры обновляются только по событиям.
- Проверки на каждом шаге: `npm test`, `npm run build`, `npm run lint`.

## Задачи (все выполнены 2026-08-29)

- [x] **1. `src/sim/factions.ts`** — `FactionId`, `FACTIONS` (название, цвет, арсенал),
      `FACTION_CITIES` (списки имён), `factionOfCity(name)`, агрегаты. Чистый TS, без three.
- [x] **2. `src/sim/cities.ts`** — `City.faction`, заполняется в `createCities()`.
- [x] **3. Контракты** — `commands.ts` (`salvo` + from/to), `events.ts`
      (`missileLaunched.faction?`, `cityHit.faction/alive`, `factionsChanged`).
- [x] **4. `Simulation`** — арсеналы, выбор агрессора/цели, старты у городов агрессора
      с джиттером, трата арсенала, эмит `factionsChanged`, восстановление на reset.
- [x] **5. Тесты sim** — `test/sim/factions.test.ts`, переписанный `test/sim/salvo.test.ts`,
      дополнение `test/sim/simulation.test.ts`.
- [x] **6. `render/CityMarkersView.ts`** + подключение в `Scene` (cityHit / planetReset /
      скрытие при расколе).
- [x] **7. `MissileView`** — цвет следа по фракции (пер-слотовый юниформ).
- [x] **8. `Hud`** — панель сторон, селекты «кто бьёт»/«по кому», фракция в ленте.
- [x] **9. Версия 0.9.0** в `assets/changelog.ts` + тест данных ченджлога.
- [x] **10. Банк памяти** — `activeContext.md`, `progress.md`.
