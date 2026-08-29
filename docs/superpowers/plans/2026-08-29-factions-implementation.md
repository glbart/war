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

## Задачи

- [ ] **1. `src/sim/factions.ts`** — `FactionId`, `FACTIONS` (название, цвет, арсенал),
      `FACTION_CITIES` (списки имён), `factionOfCity(name)`, агрегаты. Чистый TS, без three.
- [ ] **2. `src/sim/cities.ts`** — `City.faction`, заполняется в `createCities()`.
- [ ] **3. Контракты** — `commands.ts` (`salvo` + from/to), `events.ts`
      (`missileLaunched.faction?`, `cityHit.faction/alive`, `factionsChanged`).
- [ ] **4. `Simulation`** — арсеналы, выбор агрессора/цели, старты у городов агрессора
      с джиттером, трата арсенала, эмит `factionsChanged`, восстановление на reset.
- [ ] **5. Тесты sim** — `test/sim/factions.test.ts`, переписанный `test/sim/salvo.test.ts`,
      дополнение `test/sim/simulation.test.ts`.
- [ ] **6. `render/CityMarkersView.ts`** + подключение в `Scene` (cityHit / planetReset /
      скрытие при расколе).
- [ ] **7. `MissileView`** — цвет следа по фракции (пер-слотовый юниформ).
- [ ] **8. `Hud`** — панель сторон, селекты «кто бьёт»/«по кому», фракция в ленте.
- [ ] **9. Версия 0.9.0** в `assets/changelog.ts` + тест данных ченджлога.
- [ ] **10. Банк памяти** — `activeContext.md`, `progress.md`.
