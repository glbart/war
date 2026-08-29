# Дипломатия и ответный удар — план реализации

**Спека:** `docs/superpowers/specs/2026-08-29-retaliation-design.md`
**Ветка:** `claude/upcoming-features-status-rnx8r3`

**Цель:** стороны отвечают на удары сами; союзники втягиваются; обмен раскручивается
и затухает по мере исчерпания арсеналов.

## Задачи (все выполнены 2026-08-29)

- [x] **1. `src/sim/diplomacy.ts`** — `Doctrine`, блоки союзников `alliesOf`, формула
      `responseSize` (обида + арсенал + доктрина + признак союзника), чистый TS под vitest.
- [x] **2. Контракты** — `Warhead.faction`, `detonate.faction?`, команда `setDoctrine`,
      события `retaliationLaunched` и `doctrineChanged`, `FactionStat.enemies`.
- [x] **3. `Simulation`** — атрибуция удара по `hits`, планирование ответов с накоплением
      обиды, тик отложенных ответов, состояние войн, общий `launchSalvo` для кнопки и мести,
      очистка на reset.
- [x] **4. Тесты** — `test/sim/diplomacy.test.ts` (8), `test/sim/retaliation.test.ts` (15).
- [x] **5. HUD** — селект доктрины, значок ⚔ с перечнем противников, строки ленты об
      ответных ударах, сторона игрока для ручного клика (`main.ts`).
- [x] **6. Версия 0.10.0** в ченджлоге; банк памяти обновлён.
