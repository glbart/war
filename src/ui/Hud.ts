// HUD: панель счётчиков (бомбы/мегатонны/жертвы), лента поражённых городов, кнопки мощности
// заряда, «Восстановить планету», «Границы и названия». Порт разметки/логики
// reference/earth-nuke.html ~44-57 (#ui), ~1000-1045 (updateStats/addFeedEntry/обработчики
// кнопок), fmtPeople ~447-449. Единственный потребитель SimHost.post() со стороны кнопок;
// onEvent() — единственный вход для событий симуляции (main.ts раздаёт их из того же
// кадрового батча drainEvents(), которым уже пользуется Scene).
import './styles.css';
import type { SimHost } from '../sim/SimHost';
import type { SimEvent } from '../sim/events';

const DEFAULT_YIELD = 10;
const FEED_MAX_ENTRIES = 5;

// Формат числа жертв: >=1 млн — "N,N млн" (запятая вместо точки — как в эталоне),
// иначе — "NNN тыс." (минимум 1). Порт fmtPeople ~447-449. m — в миллионах человек
// (deaths/pop в City/CasualtyHit уже в этих единицах, см. sim/cities.ts).
function fmtPeople(m: number): string {
  return m >= 1
    ? m.toFixed(1).replace('.', ',') + ' млн'
    : Math.max(1, Math.round(m * 1000)) + ' тыс.';
}

export class Hud {
  // Выбранная кнопкой мощность — единственное клиентское UI-состояние Hud; читается
  // вызывающей стороной (main.ts) в момент клика по глобусу, чтобы приложить к команде
  // 'detonate' (сама Simulation получает yield явно в команде, а не из своего currentYield —
  // см. Command.detonate в src/sim/commands.ts).
  private _currentYield = DEFAULT_YIELD;

  private readonly bombsEl: HTMLElement;
  private readonly megatonsEl: HTMLElement;
  private readonly deathsEl: HTMLElement;
  private readonly integrityEl: HTMLElement;
  private lastIntegrityPct = 100; // кэш выведенного процента — DOM трогаем только при смене
  private readonly feedEl: HTMLElement;
  private readonly labelsBtn: HTMLButtonElement;
  private readonly yieldButtons: HTMLButtonElement[];

  // Метка времени (performance.now()) последнего explosionStarted — база задержки atWaveTime
  // для последующих cityHit (тот же кадровый батч событий), чтобы города «гасли» в ленте
  // по мере прихода ударной волны, а не все разом в момент детонации.
  private waveT0 = performance.now();
  // Увеличивается на planetReset — отменяет ещё не сработавшие setTimeout от предыдущей
  // волны (иначе жертвы старого удара могли бы всплыть в ленте уже после восстановления планеты).
  private resetGen = 0;

  constructor(private readonly host: SimHost) {
    const root = document.createElement('div');
    root.id = 'ui';
    root.innerHTML = `
      <h1>☢ ЯДЕРНАЯ ПЕСОЧНИЦА</h1>
      <div id="stats">Бомб сброшено: <b id="bombs">0</b><br>Суммарно: <b id="megatons">0</b> Мт<br>Жертвы: <b id="deaths">0</b><br>Целостность коры: <b id="integrity">100%</b></div>
      <div id="feed"></div>
      <div class="row">
        <button data-yield="1">1 Мт</button>
        <button data-yield="10" class="active">10 Мт</button>
        <button data-yield="100">100 Мт</button>
      </div>
      <button id="reset">Восстановить планету</button>
      <button id="labels" class="active" style="width: 100%; margin-top: 8px">Границы и названия: вкл</button>
      <p id="hint">Крути планету мышью · колесо — зум<br>Клик по планете — удар</p>
      <p id="credit">Границы и названия: Esri</p>
    `;
    document.body.appendChild(root);

    this.bombsEl = root.querySelector<HTMLElement>('#bombs')!;
    this.megatonsEl = root.querySelector<HTMLElement>('#megatons')!;
    this.deathsEl = root.querySelector<HTMLElement>('#deaths')!;
    this.integrityEl = root.querySelector<HTMLElement>('#integrity')!;
    this.feedEl = root.querySelector<HTMLElement>('#feed')!;
    this.labelsBtn = root.querySelector<HTMLButtonElement>('#labels')!;
    const resetBtn = root.querySelector<HTMLButtonElement>('#reset')!;
    this.yieldButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-yield]'));

    for (const btn of this.yieldButtons) {
      btn.addEventListener('click', () => this.selectYield(btn));
    }
    resetBtn.addEventListener('click', () => this.host.post({ kind: 'reset' }));
    // Подпись/активность кнопки границ обновляется только по факту labelsToggled от sim —
    // сам клик не трогает DOM сразу (см. onEvent), чтобы UI всегда отражал состояние sim.
    this.labelsBtn.addEventListener('click', () => this.host.post({ kind: 'toggleLabels' }));
  }

  // Текущая выбранная мощность заряда — читается main.ts при клике по глобусу.
  get currentYield(): number {
    return this._currentYield;
  }

  private selectYield(selected: HTMLButtonElement): void {
    const y = Number(selected.dataset.yield);
    this._currentYield = y;
    for (const btn of this.yieldButtons) btn.classList.toggle('active', btn === selected);
    this.host.post({ kind: 'setYield', yield: y });
  }

  // Целостность коры (0..1) — опрашивается main.ts раз за кадр; DOM трогаем только при
  // смене целого процента. Пороги окраски: <70% жёлтый, <35% красный (задел этапа 4).
  setIntegrity(v: number): void {
    const pct = Math.round(v * 100);
    if (pct === this.lastIntegrityPct) return;
    this.lastIntegrityPct = pct;
    this.integrityEl.textContent = `${pct}%`;
    this.integrityEl.style.color = pct < 35 ? '#ff5544' : pct < 70 ? '#ffcc44' : '';
  }

  // Разбирает событие симуляции (уже слитое main.ts через host.drainEvents() и розданное
  // и в Scene, и сюда из того же кадрового батча — см. комментарий в Scene.handleEvents).
  onEvent(e: SimEvent): void {
    switch (e.kind) {
      case 'explosionStarted':
        this.waveT0 = performance.now();
        break;
      case 'cityHit':
        this.scheduleFeedEntry(e.name, e.deaths, e.atWaveTime);
        break;
      case 'statsChanged':
        this.bombsEl.textContent = String(e.bombs);
        this.megatonsEl.textContent = String(e.megatons);
        this.deathsEl.textContent = e.deaths > 0 ? fmtPeople(e.deaths) : '0';
        break;
      case 'planetReset':
        this.resetGen += 1;
        this.feedEl.replaceChildren();
        break;
      case 'labelsToggled':
        this.labelsBtn.classList.toggle('active', e.enabled);
        this.labelsBtn.textContent = e.enabled
          ? 'Границы и названия: вкл'
          : 'Границы и названия: выкл';
        break;
      default:
        break; // missileLaunched — не забота Hud
    }
  }

  // Планирует появление строки в ленте через atWaveTime секунд от momента прихода волны
  // (explosionStarted), а не сразу — сохраняет эффект «города гаснут по мере прихода волны»
  // (порт синхронизации из брифа Task 10, Step 2). cityHit приходит в том же кадровом батче,
  // что и его explosionStarted, поэтому elapsed здесь практически всегда ~0, но вычисляем
  // честно на случай будущих отклонений в диспетчеризации событий.
  private scheduleFeedEntry(name: string, deaths: number, atWaveTime: number): void {
    const gen = this.resetGen;
    const elapsedMs = performance.now() - this.waveT0;
    const delayMs = Math.max(0, atWaveTime * 1000 - elapsedMs);
    setTimeout(() => {
      if (gen !== this.resetGen) return; // планета восстановлена раньше, чем долетела волна
      this.pushFeedEntry(name, deaths);
    }, delayMs);
  }

  private pushFeedEntry(name: string, deaths: number): void {
    const div = document.createElement('div');
    div.textContent = `☠ ${name} — ${fmtPeople(deaths)}`;
    this.feedEl.prepend(div);
    while (this.feedEl.children.length > FEED_MAX_ENTRIES) this.feedEl.lastChild?.remove();
  }
}
