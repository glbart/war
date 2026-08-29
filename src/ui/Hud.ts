// HUD: панель счётчиков (бомбы/мегатонны/жертвы), лента поражённых городов, кнопки мощности
// заряда, «Восстановить планету», «Границы и названия». Порт разметки/логики
// reference/earth-nuke.html ~44-57 (#ui), ~1000-1045 (updateStats/addFeedEntry/обработчики
// кнопок), fmtPeople ~447-449. Единственный потребитель SimHost.post() со стороны кнопок;
// onEvent() — единственный вход для событий симуляции (main.ts раздаёт их из того же
// кадрового батча drainEvents(), которым уже пользуется Scene).
import './styles.css';
import type { SimHost } from '../sim/SimHost';
import type { SimEvent, FactionStat } from '../sim/events';
import { FACTIONS, BELLIGERENTS, factionById, type FactionId } from '../sim/factions';
import { createCities } from '../sim/cities';

const DEFAULT_YIELD = 100;
const FEED_MAX_ENTRIES = 5;
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
    { pop: HTMLElement; ars: HTMLElement; row: HTMLElement }
  >();
  private readonly factionTotals = totalPops();
  private readonly attackerSel: HTMLSelectElement;
  private readonly targetSel: HTMLSelectElement;
  private readonly salvoBtn: HTMLButtonElement;
  private lastStats: FactionStat[] = [];

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
      <div id="stats">Бомб сброшено: <b id="bombs">0</b><br>Суммарно: <b id="megatons">0</b> Мт<br>Жертвы: <b id="deaths">0</b><br>Целостность коры: <b id="integrity">100%</b></div>
      <div id="feed"></div>
      <div id="factions"></div>
      <div class="row">
        <button data-yield="1">1 Мт</button>
        <button data-yield="10">10 Мт</button>
        <button data-yield="100" class="active">100 Мт</button>
      </div>
      <div class="row" id="salvo-sides">
        <select id="attacker" title="кто наносит удар"></select>
        <span class="arrow">→</span>
        <select id="target" title="по кому удар"></select>
      </div>
      <button id="salvo" style="width: 100%; margin-bottom: 8px">☢ Залп МБР</button>
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
    this.shatterEl = root.querySelector<HTMLElement>('#shatter')!;
    this.feedEl = root.querySelector<HTMLElement>('#feed')!;
    this.labelsBtn = root.querySelector<HTMLButtonElement>('#labels')!;
    const resetBtn = root.querySelector<HTMLButtonElement>('#reset')!;
    this.yieldButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-yield]'));
    this.attackerSel = root.querySelector<HTMLSelectElement>('#attacker')!;
    this.targetSel = root.querySelector<HTMLSelectElement>('#target')!;
    this.salvoBtn = root.querySelector<HTMLButtonElement>('#salvo')!;
    this.buildFactionRows(root.querySelector<HTMLElement>('#factions')!);
    this.buildSideSelects();

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
      const pop = document.createElement('span');
      pop.className = 'f-pop';
      const ars = document.createElement('span');
      ars.className = 'f-ars';
      row.append(dot, name, pop, ars);
      container.append(row);
      this.factionRows.set(f.id, { pop, ars, row });
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
      // Нейтральные не воюют — арсенала у них нет и колонка остаётся пустой.
      const ars = s.id === 'neutral' ? '' : `☢ ${s.arsenal}`;
      if (row.ars.textContent !== ars) row.ars.textContent = ars;
      row.row.classList.toggle('fallen', fallen);
    }
    this.updateSalvoButton();
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

  private pushFeedEntry(name: string, deaths: number, faction: FactionId): void {
    const div = document.createElement('div');
    div.textContent = `☠ ${name} (${factionById(faction).name}) — ${fmtPeople(deaths)}`;
    this.feedEl.prepend(div);
    while (this.feedEl.children.length > FEED_MAX_ENTRIES) this.feedEl.lastChild?.remove();
  }
}
