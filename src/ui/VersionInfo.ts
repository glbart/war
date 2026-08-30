// Версия симуляции и окно «Что нового» (быстрая фича 2026-07-14). Бейдж версии — внизу
// справа; модал с ченджлогом всплывает при первом открытии НОВОЙ версии (localStorage
// помнит последнюю просмотренную) и повторно открывается кликом по бейджу.
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
  if (seen === CURRENT_VERSION) overlay.style.display = 'none';
}
