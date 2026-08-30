// Версия симуляции и окно «Что нового» (быстрая фича 2026-07-14). Бейдж версии — внизу
// справа; модал с ченджлогом всплывает у ВЕРНУВШЕГОСЯ игрока, когда версия сменилась
// (localStorage помнит последнюю просмотренную), и повторно открывается кликом по бейджу.
//
// Новичку (в хранилище пусто) окно не показываем вовсе: его первый экран — стартовое меню,
// а не список изменений, которых он не видел (спека 2026-08-30-onboarding-ui-design §2).
import { CHANGELOG, CURRENT_VERSION } from '../assets/changelog';

const SEEN_KEY = 'war.seenVersion';

// Собирает DOM бейджа и модала, решает, показывать ли модал при старте.
export function initVersionInfo(): void {
  const badge = document.createElement('div');
  badge.id = 'version-badge';
  badge.textContent = `v${CURRENT_VERSION}`;
  badge.title = 'Что нового';
  document.body.appendChild(badge);

  const overlay = document.createElement('div');
  overlay.id = 'changelog-overlay';
  const entries = CHANGELOG.map(
    (e) => `
      <div class="cl-entry">
        <h3>v${e.version} — ${e.title} <span class="cl-date">${e.date}</span></h3>
        <ul>${e.changes.map((c) => `<li>${c}</li>`).join('')}</ul>
      </div>`,
  ).join('');
  overlay.innerHTML = `
    <div id="changelog">
      <h2>☢ Что нового</h2>
      <div class="cl-list">${entries}</div>
      <button id="changelog-close">Понятно</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = (): void => {
    overlay.style.display = 'none';
    try {
      localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
    } catch {
      // приватный режим/запрет storage — окно просто будет всплывать каждый раз
    }
  };
  const open = (): void => {
    overlay.style.display = '';
  };

  overlay.querySelector<HTMLButtonElement>('#changelog-close')!.addEventListener('click', close);
  // Клик по фону (мимо карточки) тоже закрывает.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  badge.addEventListener('click', open);

  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
  } catch {
    seen = null;
  }
  // Показываем только тому, кто уже играл в другую версию. Новичку молча запоминаем версию,
  // чтобы окно не всплыло у него при следующем заходе как «что нового» о том, что он и так
  // видел впервые.
  if (seen === null) {
    overlay.style.display = 'none';
    try {
      localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
    } catch {
      // приватный режим — не беда, в следующий раз просто покажем окно
    }
  } else if (seen === CURRENT_VERSION) {
    overlay.style.display = 'none';
  }
}
