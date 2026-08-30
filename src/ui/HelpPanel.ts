// Справка «Как играть» (спека 2026-08-30-onboarding-ui-design §3.3): оверлей поверх сцены,
// собранный из данных RULES. Открывается из стартового меню и кнопкой «?» в HUD (клавиша H).
// Никакой логики игры здесь нет — только показ текста, поэтому проверяются данные, а не он.

import { RULES, TOOL_BRIEFS } from '../assets/briefing';

export class HelpPanel {
  private readonly root: HTMLElement;
  // Пока справка открыта, игра стоит: main.ts спрашивает это перед host.step().
  private opened = false;
  onClose: (() => void) | undefined;

  constructor() {
    const root = document.createElement('div');
    root.id = 'help-overlay';
    root.style.display = 'none';
    const sections = RULES.map(
      (s) =>
        `<section><h3>${s.title}</h3><ul>${s.items.map((i) => `<li>${i}</li>`).join('')}</ul></section>`,
    ).join('');
    const tools = TOOL_BRIEFS.map(
      (t) =>
        `<tr><td class="t-icon">${t.icon}</td><td class="t-name">${t.name}</td>
         <td class="t-cost">${t.cost}</td><td>${t.what}<br><span class="t-when">${t.when}</span></td></tr>`,
    ).join('');
    root.innerHTML = `
      <div id="help">
        <h2>Как играть</h2>
        <div class="help-body">
          ${sections}
          <section>
            <h3>Инструменты влияния</h3>
            <table class="help-tools">${tools}</table>
          </section>
        </div>
        <button id="help-close">Понятно</button>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    root
      .querySelector<HTMLButtonElement>('#help-close')!
      .addEventListener('click', () => this.close());
    // Клик по затемнению вне окна — тоже закрытие: так ведут себя все модалки.
    root.addEventListener('click', (e) => {
      if (e.target === root) this.close();
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.root.style.display = '';
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.style.display = 'none';
    this.onClose?.();
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }
}
