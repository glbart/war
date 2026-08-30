// Стартовое меню и экран паузы (спека 2026-08-30-onboarding-ui-design §3.1-3.2): первое, что
// видит человек, открывший игру. Здесь он узнаёт цель партии и выбирает сторону и сценарий —
// то, чего в прежнем HUD не было вовсе (сторона пряталась в селекте «кто бьёт»).
//
// Меню — клиентское состояние: оно только собирает выбор и отдаёт его наружу колбэком.
// Команды симуляции (setScenario/setSide) и снятие паузы делает main.ts.

import { NUCLEAR_POWERS, factionById, type FactionId } from '../sim/factions';
import { SCENARIOS, DEFAULT_SCENARIO, type ScenarioId } from '../sim/scenarios';
import { POWER_BRIEFS, type PlayablePowerId } from '../assets/briefing';
import { CAMPAIGN_T, PROLIF_LOSS_COUNT } from '../assets/config';

export const DEFAULT_SIDE: PlayablePowerId = 'usa';

export interface StartChoice {
  side: FactionId;
  scenario: ScenarioId;
}

// Цвет стороны в CSS (в данных фракций компоненты хранятся в 0..1).
function cssColor(id: FactionId): string {
  const [r, g, b] = factionById(id).color;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export class StartMenu {
  private readonly root: HTMLElement;
  private readonly sidesEl: HTMLElement;
  private readonly scenariosEl: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private side: FactionId = DEFAULT_SIDE;
  private scenario: ScenarioId = DEFAULT_SCENARIO;
  private opened = true; // при загрузке меню открыто: партия ждёт решения игрока
  private mode: 'start' | 'pause' = 'start';

  // Игрок нажал «Начать партию» — main.ts перезапускает партию с этим выбором.
  onStart: ((choice: StartChoice) => void) | undefined;
  // «Продолжить» в режиме паузы.
  onResume: (() => void) | undefined;
  // «Как играть» — открыть справку (её владелец — main.ts, чтобы пауза считалась в одном месте).
  onHelp: (() => void) | undefined;

  constructor() {
    const root = document.createElement('div');
    root.id = 'menu-overlay';
    root.innerHTML = `
      <div id="menu">
        <h1 id="menu-title">☢ Ядерная стратегия</h1>
        <p id="menu-goal">
          Вы — ядерная держава. У вас <b>${Math.round(CAMPAIGN_T / 60)} минут</b>, чтобы не дать
          бомбе расползтись по миру: договоры, санкции, инспекции, разведка, зонтики и резолюции
          ООН. Если новых ядерных держав станет <b>${PROLIF_LOSS_COUNT}</b> — вы проиграли.
        </p>
        <h2>За кого играем</h2>
        <div id="menu-sides"></div>
        <h2>Сценарий партии</h2>
        <div id="menu-scenarios"></div>
        <div id="menu-actions">
          <button id="menu-resume" style="display: none">Продолжить</button>
          <button id="menu-start" class="primary">Начать партию</button>
          <button id="menu-help">Как играть</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.titleEl = root.querySelector<HTMLElement>('#menu-title')!;
    this.sidesEl = root.querySelector<HTMLElement>('#menu-sides')!;
    this.scenariosEl = root.querySelector<HTMLElement>('#menu-scenarios')!;
    this.startBtn = root.querySelector<HTMLButtonElement>('#menu-start')!;
    this.resumeBtn = root.querySelector<HTMLButtonElement>('#menu-resume')!;
    this.buildSides();
    this.buildScenarios();
    this.startBtn.addEventListener('click', () => {
      this.close();
      this.onStart?.({ side: this.side, scenario: this.scenario });
    });
    this.resumeBtn.addEventListener('click', () => {
      this.close();
      this.onResume?.();
    });
    root
      .querySelector<HTMLButtonElement>('#menu-help')!
      .addEventListener('click', () => this.onHelp?.());
  }

  private buildSides(): void {
    for (const f of NUCLEAR_POWERS) {
      const brief = POWER_BRIEFS[f.id as PlayablePowerId];
      const card = document.createElement('button');
      card.className = 'side-card';
      card.dataset.side = f.id;
      card.innerHTML = `
        <span class="sc-head"><i style="background:${cssColor(f.id)}"></i>${f.name}</span>
        <span class="sc-blurb">${brief.blurb}</span>
        <span class="sc-meta">☢ ${f.arsenal} боеголовок · ${brief.difficulty} партия</span>
      `;
      card.addEventListener('click', () => this.selectSide(f.id));
      this.sidesEl.append(card);
    }
    this.selectSide(this.side);
  }

  private buildScenarios(): void {
    for (const sc of SCENARIOS) {
      const card = document.createElement('button');
      card.className = 'scen-card';
      card.dataset.scenario = sc.id;
      card.innerHTML = `<span class="sc-head">${sc.name}</span><span class="sc-blurb">${sc.hint}</span>`;
      card.addEventListener('click', () => this.selectScenario(sc.id));
      this.scenariosEl.append(card);
    }
    this.selectScenario(this.scenario);
  }

  private selectSide(id: FactionId): void {
    this.side = id;
    for (const el of this.sidesEl.querySelectorAll<HTMLElement>('.side-card')) {
      el.classList.toggle('selected', el.dataset.side === id);
    }
  }

  private selectScenario(id: ScenarioId): void {
    this.scenario = id;
    for (const el of this.scenariosEl.querySelectorAll<HTMLElement>('.scen-card')) {
      el.classList.toggle('selected', el.dataset.scenario === id);
    }
  }

  get isOpen(): boolean {
    return this.opened;
  }

  // Режим паузы отличается от первого запуска только заголовком и кнопкой «Продолжить»:
  // выбор стороны и сценария остаётся доступным — из паузы можно начать заново другой стороной.
  open(mode: 'start' | 'pause' = 'pause'): void {
    this.mode = mode;
    this.opened = true;
    this.root.style.display = '';
    this.titleEl.textContent = mode === 'pause' ? '⏸ Пауза' : '☢ Ядерная стратегия';
    this.resumeBtn.style.display = mode === 'pause' ? '' : 'none';
    this.startBtn.textContent = mode === 'pause' ? 'Начать заново' : 'Начать партию';
    this.startBtn.classList.toggle('primary', mode === 'start');
  }

  close(): void {
    this.opened = false;
    this.root.style.display = 'none';
  }

  // Esc в режиме паузы закрывает меню (продолжает партию), в стартовом — ничего не делает:
  // партия ещё не начата, продолжать нечего.
  requestClose(): void {
    if (this.mode === 'start') return;
    this.close();
    this.onResume?.();
  }
}
