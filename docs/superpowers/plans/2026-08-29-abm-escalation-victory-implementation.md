# ПРО, эскалация с переговорами и условия победы — план реализации

**Спека:** `docs/superpowers/specs/2026-08-29-abm-escalation-victory-design.md`
**Ветка:** `claude/upcoming-features-status-rnx8r3`

## Задачи (все выполнены 2026-08-29)

- [x] **1. `src/sim/defense.ts`** — данные ПРО сторон, `interceptChance`, `defenderFor`
      (зона прикрытия по ближайшему живому городу).
- [x] **2. `src/sim/diplomacy.ts`** — лестница эскалации (`responseSizeForLevel`,
      `doctrineCeiling`, `escalationName`), нравы сторон, `peaceWillingness`.
- [x] **3. `src/sim/victory.ts`** — `evaluateOutcome` (победа / взаимное уничтожение /
      исчерпание / мир), пороги павшей и боеспособной стороны.
- [x] **4. Контракты** — `Warhead.abmTried`, команды `setSide`/`proposeCeasefire`/
      `ceasefireResponse`, события `interception`, `ceasefire*`, `truceBroken`, `gameOver`,
      `FactionStat.interceptors` и уровни в `enemies`.
- [x] **5. `Simulation`** — перехват на подлёте, отношения пар (уровень/тишина/перемирие/
      пауза переговоров), переговоры раз в 5 с, предложения игроку с таймером, счётчики
      партии и объявление исхода, очистка на reset.
- [x] **6. Рендер** — `render/InterceptView.ts` (вспышка перехвата) + подключение в Scene,
      общая константа `SPACE_STRIKE_START_R` с MissileView.
- [x] **7. HUD** — 🛡 перехватчики и уровни конфликта в строках сторон, ленты ПРО и
      переговоров, блок входящего предложения перемирия, кнопка «☮ Перемирие», экран итогов
      с таблицей и кнопкой «Начать заново»; dev-хук `__hud` для headless-приёмки редких окон.
- [x] **8. Тесты** — defense (4), victory (8), diplomacy (17), warflow (14); общие помощники
      `test/helpers/war.ts`; старые тесты приведены к реальности с ПРО.
- [x] **9. Версия 0.11.0**, банк памяти, спека и план.
