// HUD: панель управления партией. С версии 0.16 разбита на именованные секции (спека
// 2026-08-30-onboarding-ui-design §3.4): шапка «за кого играем», цель партии с таймером,
// ядерные программы с инструментами влияния, хроника, а редкое (стороны мира, военные
// действия, вид) свёрнуто. Сторона игрока сюда приходит из стартового меню (setSide) —
// прежнего селекта «кто бьёт» больше нет.
//
// Единственный потребитель SimHost.post() со стороны кнопок; onEvent() — единственный вход
// для событий симуляции (main.ts раздаёт их из того же кадрового батча drainEvents(),
// которым уже пользуется Scene).
import './styles.css';
import type { SimHost } from '../sim/SimHost';
import type {
  SimEvent,
  FactionStat,
  SideSummary,
  ProgramView,
  CampaignSummary,
} from '../sim/events';
import { FACTIONS, ASPIRANTS, factionById, type FactionId } from '../sim/factions';
import { STAGE_NAMES } from '../sim/proliferation';
import { CAMPAIGN_T, PROLIF_LOSS_COUNT } from '../assets/config';
import { TOOL_BRIEFS, type ToolBrief, type ToolId } from '../assets/briefing';
import { SCENARIOS, DEFAULT_SCENARIO, type ScenarioId } from '../sim/scenarios';
import { RESOLUTION_NAMES } from '../sim/un';
import {
  DOCTRINES,
  DOCTRINE_NAMES,
  DEFAULT_DOCTRINE,
  escalationName,
  type Doctrine,
} from '../sim/diplomacy';
import { OUTCOME_TITLES, type Outcome } from '../sim/victory';
import { ACTION_NAMES, type ActionId, type Candidate } from '../sim/ai/types';
import { createCities } from '../sim/cities';

// Ключ localStorage для состояния раскрытия секций: раскрыл один раз — так и осталось
// (спека §6: сворачивание не должно прятать функции навсегда).
const SECTIONS_KEY = 'hud-sections-v1';

const DEFAULT_YIELD = 100;
// 7 (было 5): в ленте теперь два потока — погибшие города и пуски ответных ударов.
const FEED_MAX_ENTRIES = 7;
// Ниже этой доли исходного населения сторона считается павшей (значок ☠, строка гаснет).
const FACTION_FALLEN_FRAC = 0.01;
// Значение «случайно» в селектах сторон: пустая строка → поле команды не задаётся,
// сторону выбирает симуляция.
const ANY = '';

// Исходное население каждой стороны (млн) — знаменатель для «павшей» стороны. Считается
// один раз из тех же чистых данных городов, что и у симуляции.
function totalPops(): Map<FactionId, number> {
  const totals = new Map<FactionId, number>(FACTIONS.map((f) => [f.id, 0]));
  for (const c of createCities()) totals.set(c.faction, (totals.get(c.faction) ?? 0) + c.pop);
  return totals;
}

// В таблице итогов ноль должен читаться нулём: fmtPeople округляет всё ненулевое вверх
// до «1 тыс.», что для сводки выглядит как потери там, где их не было.
function fmtOrZero(m: number): string {
  return m < 0.001 ? '0' : fmtPeople(m);
}

// Склонение слова «ракета» по числу — для строк ленты об ответных ударах.
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ракета';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ракеты';
  return 'ракет';
}

// Цвет стороны в CSS (компоненты хранятся в 0..1).
function cssColor(id: FactionId): string {
  const [r, g, b] = factionById(id).color;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

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
  private readonly shatterEl: HTMLElement;
  private lastShattered = false; // кэш баннера раскола — DOM только при смене
  private readonly feedEl: HTMLElement;
  private readonly labelsBtn: HTMLButtonElement;
  private readonly mapBtn: HTMLButtonElement;
  // Переключение вида «глобус ↔ плоская карта» живёт в main.ts (это клиентское состояние
  // рендера, симуляции о нём знать не нужно) — HUD только даёт кнопку.
  onToggleMap: (() => void) | undefined;
  // Выбор цели инструментов сменился — карта подсвечивает территорию этой стороны.
  onProgramSelect: ((id: FactionId | undefined) => void) | undefined;
  private readonly yieldButtons: HTMLButtonElement[];
  // Панель сторон (спека 2026-08-29): строка на фракцию, DOM трогаем только при смене текста.
  private readonly factionRows = new Map<
    FactionId,
    { pop: HTMLElement; ars: HTMLElement; war: HTMLElement; row: HTMLElement }
  >();
  private readonly factionTotals = totalPops();
  private readonly targetSel: HTMLSelectElement;
  private readonly salvoBtn: HTMLButtonElement;
  private readonly doctrineSel: HTMLSelectElement; // режим ответных ударов (спека 2026-08-29)
  private readonly truceBtn: HTMLButtonElement; // предложить перемирие выбранной стороне
  private readonly offerEl: HTMLElement; // входящее предложение перемирия (кнопки да/нет)
  private readonly offerTextEl: HTMLElement;
  private offer: { from: FactionId; to: FactionId } | undefined;
  private readonly overEl: HTMLElement; // экран итогов партии
  private readonly overBodyEl: HTMLElement;
  private lastStats: FactionStat[] = [];
  // Панель «почему»: последнее решение каждой стороны с разложением оценок (спека
  // 2026-08-29-utility-ai §7). Клик по строке стороны раскрывает её логику.
  private readonly decisions = new Map<
    FactionId,
    { action: ActionId; target?: FactionId; score: number; top: Candidate[] }
  >();
  private whyFor: FactionId | undefined;
  private readonly whyEl: HTMLElement;
  // Режим «Нераспространение»: строки программ, выбранная цель и кнопки инструментов.
  private readonly programRows = new Map<
    FactionId,
    { row: HTMLElement; stage: HTMLElement; bar: HTMLElement; marks: HTMLElement }
  >();
  private programTarget: FactionId | undefined;
  private influence = 0;
  private readonly influenceEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  // Кнопки инструментов: помним бриф целиком — из него собираются подпись, цена и тултип,
  // объясняющий, почему кнопка серая (спека 2026-08-30 §3.4).
  private readonly toolButtons: { el: HTMLButtonElement; brief: ToolBrief }[] = [];
  private readonly toolHintEl: HTMLElement; // строка «почему инструменты недоступны»
  private readonly economyEl: HTMLElement;
  private readonly scenarioSel: HTMLSelectElement;
  private guaranteed = new Set<FactionId>(); // кому выдан зонтик — для переключения кнопки
  // Сторона игрока приходит из стартового меню (setSide) и дальше не меняется в течение
  // партии: ей приписываются ручные удары и залпы, ей адресуют предложения мира.
  private side: FactionId | undefined;
  private readonly sideNameEl: HTMLElement;
  private readonly sideDotEl: HTMLElement;
  // Пауза и справка — клиентские экраны, их владелец main.ts; HUD только даёт кнопки.
  onPause: (() => void) | undefined;
  onHelp: (() => void) | undefined;

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
      <div id="hud-head">
        <span id="side-badge" title="Сторона, за которую вы играете. Сменить — в меню (Esc)">
          <i id="side-dot"></i><b id="side-name">—</b>
        </span>
        <span id="head-btns">
          <button id="pause" title="Пауза и меню (Esc)">⏸</button>
          <button id="help" title="Как играть (H)">?</button>
        </span>
      </div>
      <div id="goal">
        <div class="goal-line">Не дать никому получить бомбу · осталось <b id="clock">10:00</b></div>
        <div class="goal-line">Влияние <b id="influence">0</b> · экономика <b id="economy">100%</b>
          · проигрыш при <b>${PROLIF_LOSS_COUNT}</b> новых державах</div>
      </div>
      <div id="shatter" style="display: none">☠ ПЛАНЕТА РАСКОЛОТА</div>
      <div id="peace-offer" style="display: none">
        <span id="peace-text"></span>
        <span class="row">
          <button id="peace-yes">Принять</button>
          <button id="peace-no">Отклонить</button>
        </span>
      </div>

      <details class="sec" data-sec="programs" open>
        <summary>Ядерные программы</summary>
        <div id="programs"></div>
        <div id="tool-hint"></div>
        <div id="tools"></div>
      </details>

      <details class="sec" data-sec="feed" open>
        <summary>Хроника</summary>
        <div id="feed"></div>
      </details>

      <details class="sec" data-sec="factions">
        <summary>Стороны мира</summary>
        <div id="factions"></div>
        <div id="why" style="display: none"></div>
      </details>

      <details class="sec" data-sec="war">
        <summary>Военные действия</summary>
        <div id="stats">Бомб сброшено: <b id="bombs">0</b> · суммарно <b id="megatons">0</b> Мт<br>Жертвы: <b id="deaths">0</b> · целостность коры <b id="integrity">100%</b></div>
        <div class="row" id="yield-row">
          <button data-yield="1">1 Мт</button>
          <button data-yield="10">10 Мт</button>
          <button data-yield="100" class="active">100 Мт</button>
        </div>
        <div class="row" id="salvo-sides">
          <span class="label">Удар по</span>
          <select id="target" title="по кому бьёт залп и кому предлагается перемирие"></select>
        </div>
        <div class="row" id="doctrine-row">
          <span class="label">Ответный удар</span>
          <select id="doctrine" title="как стороны отвечают на удары по себе"></select>
        </div>
        <div class="row">
          <button id="salvo">☢ Залп МБР</button>
          <button id="truce">☮ Перемирие</button>
        </div>
      </details>

      <details class="sec" data-sec="view">
        <summary>Вид и партия</summary>
        <div class="row" id="scenario-row">
          <span class="label">Сценарий</span>
          <select id="scenario" title="стартовые условия партии (перезапускает партию)"></select>
        </div>
        <button id="map">🗺 Плоская карта (M)</button>
        <button id="labels" class="active">Границы и названия: вкл</button>
        <button id="reset">↻ Начать партию заново</button>
      </details>

      <p id="hint">Мышь — вращать планету · колесо — зум · <b>M</b> — плоская карта<br>Клик по планете — ядерный удар от вашего имени · <b>Esc</b> — меню · <b>H</b> — справка</p>
      <p id="credit">Границы и названия: Esri</p>
    `;
    document.body.appendChild(root);

    this.bombsEl = root.querySelector<HTMLElement>('#bombs')!;
    this.megatonsEl = root.querySelector<HTMLElement>('#megatons')!;
    this.deathsEl = root.querySelector<HTMLElement>('#deaths')!;
    this.integrityEl = root.querySelector<HTMLElement>('#integrity')!;
    this.shatterEl = root.querySelector<HTMLElement>('#shatter')!;
    this.feedEl = root.querySelector<HTMLElement>('#feed')!;
    this.labelsBtn = root.querySelector<HTMLButtonElement>('#labels')!;
    this.mapBtn = root.querySelector<HTMLButtonElement>('#map')!;
    this.mapBtn.addEventListener('click', () => this.onToggleMap?.());
    const resetBtn = root.querySelector<HTMLButtonElement>('#reset')!;
    this.yieldButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-yield]'));
    this.targetSel = root.querySelector<HTMLSelectElement>('#target')!;
    this.salvoBtn = root.querySelector<HTMLButtonElement>('#salvo')!;
    this.doctrineSel = root.querySelector<HTMLSelectElement>('#doctrine')!;
    this.truceBtn = root.querySelector<HTMLButtonElement>('#truce')!;
    this.offerEl = root.querySelector<HTMLElement>('#peace-offer')!;
    this.offerTextEl = root.querySelector<HTMLElement>('#peace-text')!;
    const { overlay, body } = this.buildGameOver();
    this.overEl = overlay;
    this.overBodyEl = body;
    this.whyEl = root.querySelector<HTMLElement>('#why')!;
    this.sideNameEl = root.querySelector<HTMLElement>('#side-name')!;
    this.sideDotEl = root.querySelector<HTMLElement>('#side-dot')!;
    this.toolHintEl = root.querySelector<HTMLElement>('#tool-hint')!;
    root
      .querySelector<HTMLButtonElement>('#pause')!
      .addEventListener('click', () => this.onPause?.());
    root
      .querySelector<HTMLButtonElement>('#help')!
      .addEventListener('click', () => this.onHelp?.());
    this.restoreSections(root);
    this.influenceEl = root.querySelector<HTMLElement>('#influence')!;
    this.economyEl = root.querySelector<HTMLElement>('#economy')!;
    this.scenarioSel = root.querySelector<HTMLSelectElement>('#scenario')!;
    this.buildScenarioSelect();
    this.clockEl = root.querySelector<HTMLElement>('#clock')!;
    this.buildProgramRows(root.querySelector<HTMLElement>('#programs')!);
    this.bindTools(root);
    this.buildFactionRows(root.querySelector<HTMLElement>('#factions')!);
    this.buildSideSelects();
    this.buildDoctrineSelect();

    for (const btn of this.yieldButtons) {
      btn.addEventListener('click', () => this.selectYield(btn));
    }
    resetBtn.addEventListener('click', () => this.host.post({ kind: 'reset' }));
    // Залп МБР: бьёт сторона игрока по стороне-цели (пусто в селекте = «случайно» —
    // выбор и детерминизм остаются за симуляцией, см. Simulation.applySalvo).
    this.salvoBtn.addEventListener('click', () => {
      const to = this.targetSel.value as FactionId | typeof ANY;
      this.host.post({
        kind: 'salvo',
        from: this.side,
        to: to === ANY ? undefined : to,
      });
    });
    // Смена цели может сделать залп или перемирие невозможными — кнопки гаснут сразу,
    // не дожидаясь следующего события симуляции.
    this.targetSel.addEventListener('change', () => this.updateSalvoButton());
    // Предложить перемирие стороне из правого селекта (кому — та же цель, что и для залпа).
    this.truceBtn.addEventListener('click', () => {
      const from = this.currentSide;
      const to = this.targetSel.value as FactionId | typeof ANY;
      if (from === undefined || to === ANY || to === from) return;
      this.host.post({ kind: 'proposeCeasefire', from, to });
    });
    root
      .querySelector<HTMLButtonElement>('#peace-yes')!
      .addEventListener('click', () => this.answerOffer(true));
    root
      .querySelector<HTMLButtonElement>('#peace-no')!
      .addEventListener('click', () => this.answerOffer(false));
    // Доктрина ответа — состояние симуляции: селект отражает её только по doctrineChanged.
    this.doctrineSel.addEventListener('change', () =>
      this.host.post({ kind: 'setDoctrine', doctrine: this.doctrineSel.value as Doctrine }),
    );
    // Подпись/активность кнопки границ обновляется только по факту labelsToggled от sim —
    // сам клик не трогает DOM сразу (см. onEvent), чтобы UI всегда отражал состояние sim.
    this.labelsBtn.addEventListener('click', () => this.host.post({ kind: 'toggleLabels' }));
  }

  // Строки панели сторон: цветная точка, название, живое население, арсенал. Создаются
  // один раз; событие factionsChanged потом меняет только тексты.
  private buildFactionRows(container: HTMLElement): void {
    for (const f of FACTIONS) {
      const row = document.createElement('div');
      row.className = 'f-row';
      const dot = document.createElement('i');
      dot.style.background = cssColor(f.id);
      const name = document.createElement('span');
      name.className = 'f-name';
      name.textContent = f.name;
      const war = document.createElement('span');
      war.className = 'f-war'; // ⚔ — сторона в войне (title перечисляет с кем)
      const pop = document.createElement('span');
      pop.className = 'f-pop';
      const ars = document.createElement('span');
      ars.className = 'f-ars';
      row.append(dot, name, war, pop, ars);
      // Клик по строке — «почему»: показать, из чего сложилось решение этой стороны.
      row.addEventListener('click', () => this.toggleWhy(f.id));
      // Претендент попадает в список сторон, только когда получит бомбу или ввяжется в войну.
      if (f.aspirant) row.hidden = true;
      container.append(row);
      this.factionRows.set(f.id, { pop, ars, war, row });
    }
  }

  // Селект цели: бить можно по любой стороне (нейтральных тоже). Первый пункт — «случайно»
  // (сторону выберет симуляция). Агрессор больше не выбирается: это всегда сторона игрока.
  private buildSideSelects(): void {
    const fill = (sel: HTMLSelectElement, list: readonly { id: FactionId; name: string }[]) => {
      const any = document.createElement('option');
      any.value = ANY;
      any.textContent = 'случайно';
      sel.append(any);
      for (const f of list) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        sel.append(opt);
      }
    };
    fill(this.targetSel, FACTIONS);
  }

  // Панель программ: строка на претендента. Клик выбирает цель для инструментов.
  private buildProgramRows(container: HTMLElement): void {
    for (const f of ASPIRANTS) {
      const row = document.createElement('div');
      row.className = 'p-row';
      const dot = document.createElement('i');
      dot.style.background = cssColor(f.id);
      const name = document.createElement('span');
      name.className = 'p-name';
      name.textContent = f.name;
      const stage = document.createElement('span');
      stage.className = 'p-stage';
      stage.textContent = 'не подтверждена';
      const marks = document.createElement('span');
      marks.className = 'p-marks';
      const bar = document.createElement('span');
      bar.className = 'p-bar';
      const fill = document.createElement('i');
      bar.append(fill);
      row.append(dot, name, marks, stage, bar);
      row.addEventListener('click', () => this.selectProgram(f.id));
      container.append(row);
      this.programRows.set(f.id, { row, stage, bar: fill, marks });
    }
  }

  // Кнопки инструментов строятся из данных TOOL_BRIEFS: у каждой видимая подпись и цена,
  // а не голая иконка (спека 2026-08-30 §3.4, пункт 4 разбора). Тултип собирается там же —
  // «что делает» и «когда применять».
  private bindTools(root: HTMLElement): void {
    const container = root.querySelector<HTMLElement>('#tools')!;
    for (const brief of TOOL_BRIEFS) {
      const el = document.createElement('button');
      el.id = `t-${brief.id}`;
      el.className = 'tool';
      el.innerHTML = `<span class="tl-icon">${brief.icon}</span><span class="tl-name">${brief.name}</span><span class="tl-cost">${brief.cost}</span>`;
      el.addEventListener('click', () => this.useTool(brief.id));
      container.append(el);
      this.toolButtons.push({ el, brief });
    }
    this.updateTools();
  }

  // Применить инструмент к выбранной программе. Зонтик — переключатель: выдать или снять.
  private useTool(id: ToolId): void {
    const target = this.programTarget;
    if (target === undefined) return;
    switch (id) {
      case 'treaty':
        this.host.post({ kind: 'offerTreaty', target });
        break;
      case 'sanctions':
        this.host.post({ kind: 'imposeSanctions', target });
        break;
      case 'inspect':
        this.host.post({ kind: 'inspect', target });
        break;
      case 'sabotage':
        this.host.post({ kind: 'sabotage', target });
        break;
      case 'recon':
        this.host.post({ kind: 'recon', target });
        break;
      case 'guarantee':
        this.host.post({
          kind: this.guaranteed.has(target) ? 'revokeGuarantee' : 'offerGuarantee',
          target,
        });
        break;
      case 'res-sanctions':
        this.host.post({ kind: 'proposeResolution', target, resolution: 'sanctions' });
        break;
      case 'res-inspect':
        this.host.post({ kind: 'proposeResolution', target, resolution: 'inspections' });
        break;
    }
  }

  // Сценарий партии: выбор перезапускает кампанию (симуляция сама делает reset).
  private buildScenarioSelect(): void {
    for (const sc of SCENARIOS) {
      const opt = document.createElement('option');
      opt.value = sc.id;
      opt.textContent = sc.name;
      opt.title = sc.hint;
      this.scenarioSel.append(opt);
    }
    this.scenarioSel.value = DEFAULT_SCENARIO;
    this.scenarioSel.addEventListener('change', () =>
      this.host.post({ kind: 'setScenario', scenario: this.scenarioSel.value as ScenarioId }),
    );
  }

  // Выбор цели снаружи (например, кликом по стране на карте).
  selectProgramExternal(id: FactionId | undefined): void {
    if (id === undefined || !this.programRows.has(id)) return;
    if (this.programTarget !== id) this.selectProgram(id);
  }

  private selectProgram(id: FactionId): void {
    this.programTarget = this.programTarget === id ? undefined : id;
    this.onProgramSelect?.(this.programTarget);
    for (const [rowId, row] of this.programRows) {
      row.row.classList.toggle('selected', rowId === this.programTarget);
    }
    this.updateTools();
  }

  // Инструмент доступен, когда выбрана цель и хватает влияния. Обе причины недоступности
  // проговариваются вслух: строкой-подсказкой под списком программ и тултипом кнопки —
  // раньше игрок видел просто серые кнопки без объяснений (спека 2026-08-30 §3.4).
  private updateTools(): void {
    const target = this.programTarget;
    for (const { el, brief } of this.toolButtons) {
      const enough = this.influence >= brief.cost;
      el.disabled = target === undefined || !enough;
      const why =
        target === undefined
          ? 'Сначала выберите страну в списке программ.'
          : !enough
            ? `Не хватает влияния: нужно ${brief.cost}, есть ${Math.floor(this.influence)}.`
            : `Цель: ${factionById(target).name}.`;
      el.title = `${brief.name} · ${brief.cost} влияния\n${brief.what}\nКогда: ${brief.when}\n${why}`;
      // Зонтик — переключатель, и подпись должна говорить, что произойдёт по нажатию.
      if (brief.id === 'guarantee') {
        const on = target !== undefined && this.guaranteed.has(target);
        el.querySelector<HTMLElement>('.tl-name')!.textContent = on ? 'Снять зонтик' : brief.name;
      }
    }
    const hint =
      target === undefined
        ? 'Выберите страну в списке выше — тогда инструменты станут доступны.'
        : `Цель: ${factionById(target).name}. Наведите на кнопку, чтобы прочитать, что она делает.`;
    if (this.toolHintEl.textContent !== hint) this.toolHintEl.textContent = hint;
    this.toolHintEl.classList.toggle('idle', target === undefined);
  }

  // Секундный снимок кампании: влияние, часы партии и состояние всех программ.
  private updateCampaign(
    influence: number,
    elapsed: number,
    economy: number,
    programs: ProgramView[],
  ): void {
    this.influence = influence;
    const rounded = String(Math.floor(influence));
    if (this.influenceEl.textContent !== rounded) this.influenceEl.textContent = rounded;
    const eco = `${Math.round(economy * 100)}%`;
    if (this.economyEl.textContent !== eco) this.economyEl.textContent = eco;
    const left = Math.max(0, CAMPAIGN_T - elapsed);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    if (this.clockEl.textContent !== clock) this.clockEl.textContent = clock;

    for (const p of programs) {
      const row = this.programRows.get(p.id);
      if (row === undefined) continue;
      const stage = p.revealed ? STAGE_NAMES[p.stage] : 'не подтверждена';
      if (row.stage.textContent !== stage) row.stage.textContent = stage;
      row.stage.classList.toggle('unknown', !p.revealed);
      (row.bar.style as CSSStyleDeclaration).width = `${Math.round(p.progress * 100)}%`;
      row.bar.classList.toggle('armed', p.stage === 'armed');
      const marks =
        (p.treaty ? '☮' : '') +
        (p.sanctions ? (p.coalition ? '⛔⛔' : '⛔') : '') +
        (p.guarantee ? '☂' : '') +
        (p.sponsor ? '⚑' : '');
      if (row.marks.textContent !== marks) row.marks.textContent = marks;
      row.marks.title = p.sponsor ? `Спонсор программы: ${factionById(p.sponsor).name}` : '';
      // Осведомлённость: подпись к стадии показывает, насколько данным можно верить.
      row.stage.title = `Осведомлённость: ${Math.round(p.suspicion * 100)}% · экономика ${Math.round(
        p.economy * 100,
      )}%`;
      if (p.guarantee) this.guaranteed.add(p.id);
      else this.guaranteed.delete(p.id);
    }
    this.updateTools();
  }

  // Раскрывает/прячет разложение последнего решения стороны.
  private toggleWhy(id: FactionId): void {
    this.whyFor = this.whyFor === id ? undefined : id;
    this.renderWhy();
  }

  // Панель «почему»: выбранное действие и лучшие альтернативы с вкладом каждого соображения.
  // Данные — ровно те, по которым решал алгоритм (событие decisionMade), без пересчёта.
  private renderWhy(): void {
    const id = this.whyFor;
    if (id === undefined) {
      this.whyEl.style.display = 'none';
      return;
    }
    this.whyEl.style.display = '';
    const d = this.decisions.get(id);
    if (d === undefined) {
      this.whyEl.textContent = `${factionById(id).name}: решений ещё не принимала`;
      return;
    }
    const head = `${factionById(id).name}: ${ACTION_NAMES[d.action]}${
      d.target ? ' → ' + factionById(d.target).name : ''
    } (${d.score.toFixed(2)})`;
    const rows = d.top
      .map((c) => {
        const label = `${ACTION_NAMES[c.action]}${c.target ? ' → ' + factionById(c.target).name : ''}`;
        const parts = c.considerations.map((k) => `${k.name} ${k.value.toFixed(2)}`).join(' · ');
        return `<div class="why-row"><b>${c.score.toFixed(2)}</b> ${label}<br><span>${parts}</span></div>`;
      })
      .join('');
    this.whyEl.innerHTML = `<div class="why-head">${head}</div>${rows}`;
  }

  // Доктрина ответа: чем сторона отвечает на удар по себе. Значение ставит симуляция
  // (событие doctrineChanged) — селект лишь показывает её состояние.
  private buildDoctrineSelect(): void {
    for (const d of DOCTRINES) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = DOCTRINE_NAMES[d];
      this.doctrineSel.append(opt);
    }
    this.doctrineSel.value = DEFAULT_DOCTRINE;
  }

  // Кнопка залпа гаснет, когда пускать некому: у выбранного агрессора нет боеголовок или
  // живых городов (пусковых площадок); при «случайно» — когда таких сторон нет вообще.
  private updateSalvoButton(): void {
    if (this.lastStats.length === 0) return;
    const able = (s: FactionStat) => s.arsenal > 0 && s.citiesAlive > 0;
    const side = this.side;
    const can =
      side === undefined
        ? this.lastStats.some((s) => s.id !== 'neutral' && able(s))
        : this.lastStats.some((s) => s.id === side && able(s));
    this.salvoBtn.disabled = !can;
    const to = this.targetSel.value as FactionId | typeof ANY;
    const atWar =
      side !== undefined &&
      to !== ANY &&
      to !== side &&
      (this.lastStats.find((s) => s.id === side)?.enemies.some((e) => e.id === to && !e.truce) ??
        false);
    this.truceBtn.disabled = !atWar;
  }

  // Обновляет строки сторон по снимку из factionsChanged; DOM пишем только при смене текста.
  private updateFactions(stats: FactionStat[]): void {
    this.lastStats = stats;
    for (const s of stats) {
      const row = this.factionRows.get(s.id);
      if (!row) continue;
      const total = this.factionTotals.get(s.id) ?? 0;
      const fallen = total > 0 && s.popAlive < total * FACTION_FALLEN_FRAC;
      const pop = (fallen ? '☠ ' : '') + (s.popAlive > 0.05 ? fmtPeople(s.popAlive) : '—');
      if (row.pop.textContent !== pop) row.pop.textContent = pop;
      // Нейтральные не воюют — арсенала и ПРО у них нет, колонка остаётся пустой.
      const ars = s.id === 'neutral' ? '' : `☢ ${s.arsenal} 🛡 ${s.interceptors}`;
      if (row.ars.textContent !== ars) row.ars.textContent = ars;
      // Конфликты: ⚔ — идёт война, ☮ — перемирие; в подсказке уровень по каждой паре.
      const fighting = s.enemies.filter((e) => !e.truce);
      const war = fighting.length > 0 ? '⚔' : s.enemies.length > 0 ? '☮' : '';
      const title = s.enemies
        .map((e) => `${factionById(e.id).name}: ${e.truce ? 'перемирие' : escalationName(e.level)}`)
        .join(', ');
      if (row.war.textContent !== war || row.war.title !== title) {
        row.war.textContent = war;
        row.war.title = title;
      }
      row.row.classList.toggle('fallen', fallen);
      if (factionById(s.id).aspirant) row.row.hidden = s.arsenal === 0 && s.enemies.length === 0;
    }
    this.updateSalvoButton();
  }

  // Подсветка кнопки вида: показывает, в каком режиме мы сейчас.
  setMapMode(on: boolean): void {
    this.mapBtn.classList.toggle('active', on);
    this.mapBtn.textContent = on ? '🌍 Глобус (M)' : '🗺 Плоская карта (M)';
  }

  // Текущая выбранная мощность заряда — читается main.ts при клике по глобусу.
  get currentYield(): number {
    return this._currentYield;
  }

  // Сторона игрока: ей приписывается ручной удар, и мстят именно ей. Задаётся стартовым
  // меню через setSide(); до выбора — undefined (удар анонимный, спека 2026-08-29 §2).
  get currentSide(): FactionId | undefined {
    return this.side;
  }

  // Сторона игрока выбрана в меню: показать её в шапке и сообщить симуляции (без setSide
  // симуляция не знает, кому адресовать предложения мира и чью экономику считать своей).
  setSide(id: FactionId): void {
    this.side = id;
    const f = factionById(id);
    this.sideNameEl.textContent = f.name;
    this.sideDotEl.style.background = cssColor(id);
    this.host.post({ kind: 'setSide', faction: id });
    this.updateSalvoButton();
  }

  // Состояние раскрытия секций живёт в localStorage: свернул редкое — оно и осталось
  // свёрнутым, раскрыл — осталось раскрытым (спека 2026-08-30 §6).
  private restoreSections(root: HTMLElement): void {
    let saved: Record<string, boolean> = {};
    try {
      saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
    } catch {
      saved = {}; // повреждённое или недоступное хранилище — просто дефолты разметки
    }
    const sections = Array.from(root.querySelectorAll<HTMLDetailsElement>('details.sec'));
    for (const el of sections) {
      const key = el.dataset.sec;
      if (key !== undefined && typeof saved[key] === 'boolean') el.open = saved[key];
      el.addEventListener('toggle', () => {
        const state: Record<string, boolean> = {};
        for (const s of sections) if (s.dataset.sec !== undefined) state[s.dataset.sec] = s.open;
        try {
          localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
        } catch {
          // приватный режим/переполнение — не повод ронять HUD
        }
      });
    }
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

  // Баннер раскола (этап 4) — опрашивается main.ts раз за кадр, DOM только при смене.
  setShattered(v: boolean): void {
    if (v === this.lastShattered) return;
    this.lastShattered = v;
    this.shatterEl.style.display = v ? '' : 'none';
  }

  // Разбирает событие симуляции (уже слитое main.ts через host.drainEvents() и розданное
  // и в Scene, и сюда из того же кадрового батча — см. комментарий в Scene.handleEvents).
  onEvent(e: SimEvent): void {
    switch (e.kind) {
      case 'explosionStarted':
        this.waveT0 = performance.now();
        break;
      case 'cityHit':
        this.scheduleFeedEntry(e.name, e.deaths, e.atWaveTime, e.faction);
        break;
      case 'factionsChanged':
        this.updateFactions(e.factions);
        break;
      case 'retaliationLaunched':
        this.pushWarEntry(e.from, e.to, e.count, e.action);
        break;
      case 'doctrineChanged':
        this.doctrineSel.value = e.doctrine;
        break;
      case 'interception':
        this.pushLine(
          `🛡 ${factionById(e.by).name}: ${e.success ? 'ракета сбита' : 'перехват не удался'}`,
          'abm',
        );
        break;
      case 'ceasefireProposed':
        this.pushLine(
          `☮ ${factionById(e.from).name} предлагает перемирие: ${factionById(e.to).name}`,
          'peace',
        );
        if (e.forPlayer) this.showOffer(e.from, e.to);
        break;
      case 'ceasefireAccepted':
        this.pushLine(
          `☮ Перемирие: ${factionById(e.from).name} и ${factionById(e.to).name}`,
          'peace',
        );
        this.hideOffer(e.from, e.to);
        break;
      case 'ceasefireRejected':
        this.pushLine(`✖ ${factionById(e.to).name} отвергает перемирие`, 'peace');
        this.hideOffer(e.from, e.to);
        break;
      case 'truceBroken':
        this.pushLine(
          `⚔ ${factionById(e.by).name} нарушает перемирие с ${factionById(e.against).name}`,
          'war',
        );
        break;
      case 'decisionMade':
        this.decisions.set(e.faction, {
          action: e.action,
          target: e.target,
          score: e.score,
          top: e.top,
        });
        if (this.whyFor === e.faction) this.renderWhy();
        break;
      case 'campaignChanged':
        this.updateCampaign(e.influence, e.elapsed, e.economy, e.programs);
        break;
      case 'guaranteeChanged':
        this.pushLine(
          `☂ ${factionById(e.faction).name}: ${
            e.active
              ? 'под ядерным зонтиком'
              : e.broken
                ? 'зонтик сорван — влияния не хватило'
                : 'зонтик снят'
          }`,
          e.active ? 'peace' : 'prog',
        );
        break;
      case 'reconDone':
        this.pushLine(
          `🕵 Разведка ${factionById(e.faction).name}: осведомлённость ${Math.round(e.intel * 100)}%`,
          'prog',
        );
        break;
      case 'resolutionVoted': {
        const forCount = e.votes.filter((v) => v.vote === 'for').length;
        const against = e.votes.filter((v) => v.vote === 'against').length;
        const verdict = e.passed
          ? 'принята'
          : e.vetoedBy
            ? `вето: ${factionById(e.vetoedBy).name}`
            : 'отклонена';
        this.pushLine(
          `🏛 ${RESOLUTION_NAMES[e.resolution]} против ${factionById(e.target).name}: ${verdict} (${forCount}/${against})`,
          e.passed ? 'peace' : 'prog',
        );
        break;
      }
      case 'sponsorChanged':
        this.pushLine(
          e.sponsor
            ? `⚑ ${factionById(e.sponsor).name} спонсирует программу: ${factionById(e.target).name}`
            : `⚑ ${factionById(e.target).name} осталась без спонсора`,
          'war',
        );
        break;
      case 'scenarioChanged':
        this.scenarioSel.value = e.scenario;
        break;
      case 'programRevealed':
        this.pushLine(
          `🔍 ${factionById(e.faction).name}: программа подтверждена (${STAGE_NAMES[e.stage]})`,
          'prog',
        );
        break;
      case 'nuclearTest':
        this.pushLine(`☢ ${factionById(e.faction).name} провела испытание — новая держава!`, 'war');
        break;
      case 'treatyAnswer':
        this.pushLine(
          `☮ ${factionById(e.faction).name} ${e.accepted ? 'подписала договор' : 'отвергла договор'}`,
          e.accepted ? 'peace' : 'prog',
        );
        break;
      case 'sanctionsImposed':
        this.pushLine(`⛔ Санкции против: ${factionById(e.faction).name}`, 'prog');
        break;
      case 'inspected':
        this.pushLine(
          `🔍 Инспекция ${factionById(e.faction).name}: ${STAGE_NAMES[e.stage]}`,
          'prog',
        );
        break;
      case 'sabotageResult':
        this.pushLine(
          `💥 Саботаж ${factionById(e.faction).name}: ${e.success ? 'программа отброшена' : 'провал, нас раскрыли'}`,
          e.success ? 'prog' : 'war',
        );
        break;
      case 'gameOver':
        this.showGameOver(e.outcome, e.winner, e.summary, e.campaign);
        break;
      case 'statsChanged':
        this.bombsEl.textContent = String(e.bombs);
        this.megatonsEl.textContent = String(e.megatons);
        this.deathsEl.textContent = e.deaths > 0 ? fmtPeople(e.deaths) : '0';
        break;
      case 'planetReset':
        this.resetGen += 1;
        this.feedEl.replaceChildren();
        this.offer = undefined;
        this.offerEl.style.display = 'none';
        this.decisions.clear();
        this.renderWhy();
        this.overEl.style.display = 'none';
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
  private scheduleFeedEntry(
    name: string,
    deaths: number,
    atWaveTime: number,
    faction: FactionId,
  ): void {
    const gen = this.resetGen;
    const elapsedMs = performance.now() - this.waveT0;
    const delayMs = Math.max(0, atWaveTime * 1000 - elapsedMs);
    setTimeout(() => {
      if (gen !== this.resetGen) return; // планета восстановлена раньше, чем долетела волна
      this.pushFeedEntry(name, deaths, faction);
    }, delayMs);
  }

  // Универсальная строка ленты с классом-стилем (☠ города, ☢ ответы, 🛡 ПРО, ☮ переговоры).
  private pushLine(text: string, cls: string): void {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    this.feedEl.prepend(div);
    while (this.feedEl.children.length > FEED_MAX_ENTRIES) this.feedEl.lastChild?.remove();
  }

  // Входящее предложение перемирия стороне игрока: ждём его решения (молчание симуляция
  // сама засчитает как отказ по своему таймеру).
  private showOffer(from: FactionId, to: FactionId): void {
    this.offer = { from, to };
    this.offerTextEl.textContent = `${factionById(from).name} предлагает перемирие`;
    this.offerEl.style.display = '';
  }

  private hideOffer(from: FactionId, to: FactionId): void {
    if (this.offer?.from !== from || this.offer.to !== to) return;
    this.offer = undefined;
    this.offerEl.style.display = 'none';
  }

  private answerOffer(accept: boolean): void {
    if (this.offer === undefined) return;
    const { from, to } = this.offer;
    this.offer = undefined;
    this.offerEl.style.display = 'none';
    this.host.post({ kind: 'ceasefireResponse', from, to, accept });
  }

  // Экран итогов партии — создаётся один раз скрытым, наполняется по событию gameOver.
  private buildGameOver(): { overlay: HTMLElement; body: HTMLElement } {
    const overlay = document.createElement('div');
    overlay.id = 'gameover-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div id="gameover">
        <h2 id="gameover-title"></h2>
        <div id="gameover-body"></div>
        <button id="gameover-again">Начать заново</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>('#gameover-again')!.addEventListener('click', () => {
      overlay.style.display = 'none';
      this.host.post({ kind: 'reset' });
    });
    return { overlay, body: overlay.querySelector<HTMLElement>('#gameover-body')! };
  }

  private showGameOver(
    outcome: Outcome,
    winner: FactionId | undefined,
    summary: SideSummary[],
    campaign: CampaignSummary,
  ): void {
    const title = this.overEl.querySelector<HTMLElement>('#gameover-title')!;
    title.textContent = winner
      ? `${OUTCOME_TITLES[outcome]}: ${factionById(winner).name}`
      : OUTCOME_TITLES[outcome];
    const rows = summary
      .map((r) => {
        const survived = r.popTotal > 0 ? Math.round((r.popAlive / r.popTotal) * 100) : 0;
        return `<tr${winner === r.id ? ' class="winner"' : ''}>
          <td><i style="background:${cssColor(r.id)}"></i>${factionById(r.id).name}</td>
          <td>${survived}%</td>
          <td>${fmtOrZero(r.popTotal - r.popAlive)}</td>
          <td>${fmtOrZero(r.killed)}</td>
          <td>${r.launched}</td>
          <td>${r.intercepted}</td>
          <td>${r.arsenal}</td>
        </tr>`;
      })
      .join('');
    const armedNames = campaign.armed.map((id) => factionById(id).name).join(', ') || 'никто';
    this.overBodyEl.innerHTML = `
      <div class="go-campaign">
        Партия: ${Math.floor(campaign.elapsed / 60)} мин ${Math.floor(campaign.elapsed % 60)} с ·
        бомбу получили: <b>${armedNames}</b> · программ остановлено: <b>${campaign.stopped}</b><br>
        договоров ${campaign.treaties} · санкций ${campaign.sanctions} ·
        резолюций ${campaign.resolutions} · зонтиков ${campaign.guarantees} ·
        саботажей ${campaign.sabotages} · ударов по программам ${campaign.strikes}<br>
        влияния осталось ${campaign.influence} · экономика ${Math.round(campaign.economy * 100)}%
      </div>
      <table>
        <tr><th>Сторона</th><th>Выжило</th><th>Потери</th><th>Убито</th><th>Пусков</th><th>Сбито</th><th>☢</th></tr>
        ${rows}
      </table>
    `;
    this.overEl.style.display = '';
  }

  // Строка ленты об ответном ударе — сразу, без задержки волны (это пуск, а не прилёт).
  private pushWarEntry(from: FactionId, to: FactionId, count: number, action: ActionId): void {
    const div = document.createElement('div');
    div.className = 'war';
    const why = ACTION_NAMES[action];
    div.textContent = `☢ ${factionById(from).name} → ${factionById(to).name}: ${count} ${plural(count)} (${why})`;
    this.feedEl.prepend(div);
    while (this.feedEl.children.length > FEED_MAX_ENTRIES) this.feedEl.lastChild?.remove();
  }

  private pushFeedEntry(name: string, deaths: number, faction: FactionId): void {
    const div = document.createElement('div');
    div.textContent = `☠ ${name} (${factionById(faction).name}) — ${fmtPeople(deaths)}`;
    this.feedEl.prepend(div);
    while (this.feedEl.children.length > FEED_MAX_ENTRIES) this.feedEl.lastChild?.remove();
  }
}
