# План: понятный вход в игру и наведение порядка в HUD

Спека: `docs/superpowers/specs/2026-08-30-onboarding-ui-design.md`.

## Шаг 1. Данные брифинга — `src/assets/briefing.ts` ✅

- `POWER_BRIEFS` — по фразе на каждую из `NUCLEAR_POWERS`.
- `TOOL_BRIEFS` — id, иконка, короткое имя, цена (из `config.ts`), «что делает», «когда».
- `RULES` — разделы справки (заголовок + пункты).
- Тест `test/ui/briefing.test.ts`: полнота, уникальность id, цены = константы конфига.

## Шаг 2. Стартовое меню и справка — `src/ui/StartMenu.ts`, `src/ui/HelpPanel.ts` ✅

- `StartMenu` — оверлей с выбором стороны и сценария, режимы `start` и `pause`.
- Колбэки: `onStart({ side, scenario })`, `onResume()`.
- `HelpPanel` — оверлей справки из `RULES`, открывается из меню и из HUD.

## Шаг 3. Пауза в `main.ts` ✅

- Флаг `paused` (при загрузке `true`), `host.step` вызывается только когда снят.
- Esc — пауза/продолжение; меню и справка ставят игру на паузу.
- Dev-хук `__startGame()` для headless-приёмки, вызов в `scripts/accept/shots.mjs`.

## Шаг 4. Перестройка HUD — `src/ui/Hud.ts` + `styles.css` ✅

- Секции с заголовками, сворачивание, состояние в `localStorage`.
- Шапка «Вы играете за …», кнопки «⏸» и «?».
- Инструменты с текстовыми названиями и объяснением, почему серые.
- Селект «кто бьёт» убран; сторона игрока приходит из меню (`Hud.setSide`).
- Счётчики войны — в свёрнутую секцию.

## Шаг 5. Приёмка ✅

- `npm test`, `npm run build`, `npm run lint`.
- Ченджлог `0.16.0`, банк памяти (`activeContext.md`, `progress.md`).
