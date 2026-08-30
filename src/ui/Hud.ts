// HUD: панель счётчиков (бомбы/мегатонны/жертвы), лента поражённых городов, кнопки мощности
// заряда, «Восстановить планету», «Границы и названия». Порт разметки/логики
// reference/earth-nuke.html ~44-57 (#ui), ~1000-1045 (updateStats/addFeedEntry/обработчики
// кнопок), fmtPeople ~447-449. Единственный потребитель SimHost.post() со стороны кнопок;
// onEvent() — единственный вход для событий симуляции (main.ts раздаёт их из того же
// кадрового батча drainEvents(), которым уже пользуется Scene).
import './styles.css';
import type { SimHost } from '../sim/SimHost';
import type {
  SimEvent,
  FactionStat,
  SideSummary,
  ProgramView,
  CampaignSummary,
} from '../sim/events';
import { FACTIONS, BELLIGERENTS, ASPIRANTS, factionById, type FactionId } from '../sim/factions';
import { STAGE_NAMES } from '../sim/proliferation';
import {
  COST_TREATY,
  COST_SANCTIONS,
  COST_INSPECT,
  COST_SABOTAGE,
  COST_RECON,
  COST_GUARANTEE,
  COST_RESOLUTION,
  CAMPAIGN_T,
} from '../assets/config';
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
  private readonly yieldButtons: HTMLButtonElement[];
  // Панель сторон (спека 2026-08-29): строка на фракцию, DOM трогаем только при смене текста.
  private readonly factionRows = new Map<
    FactionId,
    { pop: HTMLElement; ars: HTMLElement; war: HTMLElement; row: HTMLElement }
  >();
  private readonly factionTotals = totalPops();
  private readonly attackerSel: HTMLSelectElement;
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
  private readonly toolButtons: { el: HTMLButtonElement; cost: number }[] = [];
  private readonly economyEl: HTMLElement;
  private readonly scenarioSel: HTMLSelectElement;
  private guaranteed = new Set<FactionId>(); // кому выдан зонтик — для переключения кнопки

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
      <div id="shatter" style="display: none">☠ ПЛАНЕТА РАСКОЛОТА</div>
      <div id="stats">Влияние: <b id="influence">0</b> · Экономика: <b id="economy">100%</b> · До конца: <b id="clock">10:00</b><br>Бомб сброшено: <b id="bombs">0</b><br>Суммарно: <b id="megatons">0</b> Мт<br>Жертвы: <b id="deaths">0</b><br>Целостность коры: <b id="integrity">100%</b></div>
      <div id="peace-offer" style="display: none">
        <span id="peace-text"></span>
        <span class="row">
          <button id="peace-yes">Принять</button>
          <button id="peace-no">Отклонить</button>
        </span>
      </div>
      <div id="feed"></div>
      <div id="factions"></div>
      <div id="why" style="display: none"></div>
      <div id="programs-title">Ядерные программы</div>
      <div id="programs"></div>
      <div class="row" id="tools">
        <button id="t-treaty" title="Договор: страна может заморозить программу">☮ ${COST_TREATY}</button>
        <button id="t-sanctions" title="Санкции: программа идёт втрое медленнее">⛔ ${COST_SANCTIONS}</button>
        <button id="t-inspect" title="Инспекция: раскрывает стадию и прогресс">🔍 ${COST_INSPECT}</button>
        <button id="t-sabotage" title="Саботаж: откат программы, но можно провалиться">💥 ${COST_SABOTAGE}</button>
      </div>
      <div class="row" id="tools2">
        <button id="t-recon" title="Разведка: поднимает осведомлённость о программе">🕵 ${COST_RECON}</button>
        <button id="t-guarantee" title="Ядерный зонтик: мотивация падает, но нужен постоянный расход влияния">☂ ${COST_GUARANTEE}</button>
        <button id="t-res-sanctions" title="Резолюция ООН: коалиционные санкции (нужны доказательства)">🏛⛔ ${COST_RESOLUTION}</button>
        <button id="t-res-inspect" title="Резолюция ООН: обязательные инспекции">🏛🔍 ${COST_RESOLUTION}</button>
      </div>
      <div class="row">
        <button data-yield="1">1 Мт</button>
        <button data-yield="10">10 Мт</button>
        <button data-yield="100" class="active">100 Мт</button>
      </div>
      <div class="row" id="salvo-sides">
        <select id="attacker" title="за кого играем: этой стороне приписываются и клик, и залп"></select>
        <span class="arrow">→</span>
        <select id="target" title="по кому удар"></select>
      </div>
      <div class="row" id="doctrine-row">
        <span class="label">Ответный удар</span>
        <select id="doctrine" title="как стороны отвечают на удары по себе"></select>
      </div>
      <div class="row" id="scenario-row">
        <span class="label">Сценарий</span>
        <select id="scenario" title="стартовые условия партии (перезапускает партию)"></select>
      </div>
      <div class="row">
        <button id="salvo">☢ Залп МБР</button>
        <button id="truce">☮ Перемирие</button>
      </div>
      <button id="reset">Восстановить планету</button>
      <button id="labels" class="active" style="width: 100%; margin-top: 8px">Границы и названия: вкл</button>
      <p id="hint">Крути планету мышью · колесо — зум<br>Клик по планете — удар выбранной стороны</p>
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
    const resetBtn = root.querySelector<HTMLButtonElement>('#reset')!;
    this.yieldButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-yield]'));
    this.attackerSel = root.querySelector<HTMLSelectElement>('#attacker')!;
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
    // Залп МБР: сторона-агрессор бьёт по стороне-цели (пусто в селекте = «случайно» —
    // выбор и детерминизм остаются за симуляцией, см. Simulation.applySalvo).
    this.salvoBtn.addEventListener('click', () => {
      const from = this.attackerSel.value as FactionId | typeof ANY;
      const to = this.targetSel.value as FactionId | typeof ANY;
      this.host.post({
        kind: 'salvo',
        from: from === ANY ? undefined : from,
        to: to === ANY ? undefined : to,
      });
    });
    // Смена агрессора может сделать залп невозможным (нет боеголовок/городов) — кнопка
    // гаснет сразу, не дожидаясь следующего события симуляции.
    this.attackerSel.addEventListener('change', () => this.updateSalvoButton());
    this.targetSel.addEventListener('change', () => this.updateSalvoButton());
    // Сторона игрока: симуляция должна знать её, чтобы адресовать игроку предложения мира.
    this.attackerSel.addEventListener('change', () =>
      this.host.post({ kind: 'setSide', faction: this.currentSide }),
    );
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

  // Селекты сторон: агрессор — только воюющие стороны, цель — любая (нейтральных тоже
  // можно бомбить). Первый пункт обоих — «случайно» (симуляция выберет сама).
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
    fill(this.attackerSel, BELLIGERENTS);
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

  private bindTools(root: HTMLElement): void {
    const bind = (
      id: string,
      cost: number,
      kind: 'offerTreaty' | 'imposeSanctions' | 'inspect' | 'sabotage' | 'recon',
    ) => {
      const el = root.querySelector<HTMLButtonElement>(id)!;
      el.addEventListener('click', () => {
        if (this.programTarget === undefined) return;
        this.host.post({ kind, target: this.programTarget });
      });
      this.toolButtons.push({ el, cost });
    };
    bind('#t-treaty', COST_TREATY, 'offerTreaty');
    bind('#t-sanctions', COST_SANCTIONS, 'imposeSanctions');
    bind('#t-inspect', COST_INSPECT, 'inspect');
    bind('#t-sabotage', COST_SABOTAGE, 'sabotage');
    bind('#t-recon', COST_RECON, 'recon');

    // Зонтик — переключатель: выдать или снять с выбранной страны.
    const guaranteeBtn = root.querySelector<HTMLButtonElement>('#t-guarantee')!;
    guaranteeBtn.addEventListener('click', () => {
      const target = this.programTarget;
      if (target === undefined) return;
      this.host.post({
        kind: this.guaranteed.has(target) ? 'revokeGuarantee' : 'offerGuarantee',
        target,
      });
    });
    this.toolButtons.push({ el: guaranteeBtn, cost: COST_GUARANTEE });

    const resolution = (id: string, kind: 'sanctions' | 'inspections') => {
      const el = root.querySelector<HTMLButtonElement>(id)!;
      el.addEventListener('click', () => {
        if (this.programTarget === undefined) return;
        this.host.post({ kind: 'proposeResolution', target: this.programTarget, resolution: kind });
      });
      this.toolButtons.push({ el, cost: COST_RESOLUTION });
    };
    resolution('#t-res-sanctions', 'sanctions');
    resolution('#t-res-inspect', 'inspections');
    this.updateTools();
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

  private selectProgram(id: FactionId): void {
    this.programTarget = this.programTarget === id ? undefined : id;
    for (const [rowId, row] of this.programRows) {
      row.row.classList.toggle('selected', rowId === this.programTarget);
    }
    this.updateTools();
  }

  // Инструмент доступен, когда выбрана цель и хватает влияния.
  private updateTools(): void {
    for (const { el, cost } of this.toolButtons) {
      el.disabled = this.programTarget === undefined || this.influence < cost;
    }
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
    const chosen = this.attackerSel.value as FactionId | typeof ANY;
    const can =
      chosen === ANY
        ? this.lastStats.some((s) => s.id !== 'neutral' && able(s))
        : this.lastStats.some((s) => s.id === chosen && able(s));
    this.salvoBtn.disabled = !can;
    const side = this.currentSide;
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

  // Текущая выбранная мощность заряда — читается main.ts при клике по глобусу.
  get currentYield(): number {
    return this._currentYield;
  }

  // Сторона игрока (селект «кто бьёт»): ей приписывается ручной удар, и мстят именно ей.
  // «случайно» → undefined: удар анонимный, жертва винит случайную сторону (спека §2).
  get currentSide(): FactionId | undefined {
    const v = this.attackerSel.value;
    return v === ANY ? undefined : (v as FactionId);
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
