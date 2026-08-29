import { Rng } from '../core/time';
import { createWorld } from '../ecs/world';
import type { Entity } from '../ecs/components';
import { computeCasualties, type CasualtyHit } from '../ecs/systems/CasualtySystem';
import { createCities, type City } from './cities';
import type { Command } from './commands';
import type { SimEvent, FactionStat, SideSummary } from './events';
import {
  YIELDS,
  SALVO_COUNT,
  FACTION_LAUNCH_JITTER,
  ABM_INTERCEPT_AT,
  AI_PULSE_T,
  GRIEVANCE_HALFLIFE,
  GRIEVANCE_SETTLED_PER_WARHEAD,
  ESCALATION_MAX,
  AI_GRIEVANCE_REF,
  CAMPAIGN_T,
  PROLIF_LOSS_COUNT,
  INFLUENCE_START,
  INFLUENCE_RATE,
  COST_TREATY,
  COST_SANCTIONS,
  COST_INSPECT,
  COST_SABOTAGE,
  INFLUENCE_STRIKE_PENALTY,
  SANCTION_T,
  TREATY_T,
  SABOTAGE_SUCCESS,
  SABOTAGE_SETBACK_MIN,
  SABOTAGE_SETBACK_MAX,
  CASCADE_MOTIVATION,
  NEW_POWER_ARSENAL,
  NEW_POWER_INTERCEPTORS,
  ESCALATION_DECAY_T,
  TRUCE_T,
  PEACE_OFFER_TIMEOUT,
  PEACE_COOLDOWN_T,
  PEACE_HOLD_T,
  type Yield,
} from '../assets/config';
import { materialAtDir } from './material';
import { angleBetween, jitterDir, type Vec3 } from './geo';
import { flightTimeFor, ballisticPos, spaceStrikePos } from './ballistics';

import { FACTIONS, BELLIGERENTS, ASPIRANTS, isFactionId, type FactionId } from './factions';
import {
  alliesOf,
  doctrineCeiling,
  isDoctrine,
  DEFAULT_DOCTRINE,
  TEMPERAMENTS,
  type Doctrine,
} from './diplomacy';
import { decide, type LastChoice } from './ai/decide';
import { actionSize } from './ai/actions';
import type { Decision, DecisionContext, RivalView } from './ai/types';
import { DEFENSES, interceptChance, defenderFor } from './defense';
import { evaluateOutcome, type Outcome, type SideSnapshot } from './victory';
import {
  ASPIRANT_PROFILES,
  createProgram,
  advanceProgram,
  motivationDrift,
  treatyAcceptance,
  totalProgress,
  isRevealed,
  setbackByStrike,
  setbackByFraction,
  type Program,
} from './proliferation';

// Время полёта боеголовки до детонации, сек (порт таймингов демо).
const FLIGHT_TIME = 2.6;

// Порог «город ещё жив» — тот же, по которому CasualtySystem пропускает опустошённые города.
const ALIVE_EPS = 0.001;

// Отношения пары сторон: ступень лестницы эскалации, тишина (для спада), остаток перемирия
// и пауза между предложениями мира (спека 2026-08-29-abm-escalation-victory §3).
interface Relation {
  level: number;
  quiet: number;
  truce: number;
  cooldown: number;
}

// Предложение перемирия «на столе»: ждёт решения адресата (игрок — кнопкой, ИИ — на пульсе).
interface PeaceOffer {
  from: FactionId;
  to: FactionId;
  t: number;
}

// Сколько раз пробуем найти сушу под пусковую площадку рядом с городом, прежде чем уйти
// в общий фолбэк (случайная точка суши): города прибрежные, грубая landmask вокруг них
// местами вода — упереться в лимит нормально, зависнуть нельзя.
const LAUNCH_SITE_TRIES = 8;

// Мощности заряда, поддерживаемые демо (мегатонны).
type YieldMt = Yield;

// Runtime-проверка мощности заряда на границе применения команд.
// Command.yield/Warhead.yield типизированы как number (см. бриф), поэтому
// значение может прийти из будущего UI/сети произвольным — здесь это
// отсекается до того, как испорченное значение попадёт в ECS-компонент
// и таблицы ANG_PATCH/YS/TS (иначе они вернут undefined -> NaN -> необратимая
// порча c.alive, что ломает детерминизм).
function isValidYield(y: number): y is Yield {
  return (YIELDS as readonly number[]).includes(y);
}

function assertValidYield(y: number): asserts y is Yield {
  if (!isValidYield(y)) {
    throw new Error(
      `Недопустимая мощность заряда: ${y}. Разрешены только значения ${YIELDS.join(', ')} Мт.`,
    );
  }
}

// Runtime-проверка стороны на границе применения команд — по тем же мотивам, что и
// assertValidYield: id может прийти из будущего сетевого слоя произвольным, а неизвестная
// сторона иначе молча выродилась бы в «пускать некому» (залп без видимой причины не идёт).
function assertValidFaction(id: FactionId | undefined): void {
  if (id !== undefined && !isFactionId(id)) {
    throw new Error(`Неизвестная сторона: ${String(id)}.`);
  }
}

// Временной масштаб волны по мощности заряда (порт из демо, ~726): чем мощнее
// заряд, тем медленнее и тяжелее разворачивается взрыв.
const TS_TABLE: Record<YieldMt, number> = { 1: 0.8, 10: 1.0, 100: 1.4 };

// Ядро симуляции: детерминированный тик над ECS-миром боеголовок и списком городов.
// Никаких таймеров/Math.random — вся случайность идёт через собственный Rng(seed).
export class Simulation {
  private readonly world = createWorld();
  private readonly rng: Rng;
  // Идентификаторы сущностей-боеголовок для связывания missileLaunched <-> explosionStarted.
  private readonly ids = new WeakMap<Entity, number>();
  private cities: City[];
  private nextId = 1;
  private labelsEnabled = true;
  // 100 по умолчанию — синхронно с DEFAULT_YIELD/активной кнопкой Hud (решение юзера 2026-07-14).
  private currentYield = 100;

  private bombs = 0;
  private megatons = 0;
  private totalDeaths = 0;
  // Арсеналы сторон (спека 2026-08-29): тратятся по боеголовке на ракету залпа,
  // восстанавливаются на reset. Нейтральные держат 0 и агрессором не выбираются.
  private arsenals = new Map<FactionId, number>();
  private bootstrapped = false; // выдан ли стартовый factionsChanged (первый тик)
  // Дипломатия (спека 2026-08-29-retaliation): режим ответа, отложенные ответы, состояние войн.
  private doctrine: Doctrine = DEFAULT_DOCTRINE;
  // Память обид: сколько населения сторона потеряла от каждой другой (млн). Тает со временем
  // (GRIEVANCE_HALFLIFE) — страна отходит. Это главный вход соображений «за что бить».
  private grievances = new Map<string, number>();
  // Слой решений: фазы пульса и прошлый выбор каждой стороны (для инерции).
  private aiClock = 0;
  private lastChoice = new Map<FactionId, LastChoice>();
  private lastPulse = new Map<FactionId, number>();
  private lastStrikeAt = new Map<FactionId, number>(); // когда сторона в последний раз стреляла
  private relations = new Map<string, Relation>();
  private offers: PeaceOffer[] = [];
  private playerSide: FactionId | undefined; // за кого играет пользователь (setSide)
  // ПРО: остаток перехватчиков по сторонам (спека §2).
  private interceptors = new Map<FactionId, number>();
  // Итоги партии: счётчики для экрана итогов и состояние исхода.
  private launchedBy = new Map<FactionId, number>();
  private killedBy = new Map<FactionId, number>();
  private interceptedBy = new Map<FactionId, number>();
  private readonly popTotals = new Map<FactionId, number>();
  private warHappened = false;
  private quietFor = 0; // сек с последнего взрыва (для исхода «мир восстановлен»)
  private outcome: Outcome | undefined;
  // Кампания «Нераспространение» (спека 2026-08-29-nonproliferation).
  private programs = new Map<FactionId, Program>();
  private influence = INFLUENCE_START;
  private elapsed = 0; // сек с начала партии
  private campaignAcc = 0; // аккумулятор для секундного снимка кампании
  private revealedSeen = new Set<FactionId>();
  private armedOrder: FactionId[] = [];
  private toolUse = { treaties: 0, sanctions: 0, sabotages: 0, strikes: 0 };

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.cities = createCities();
    for (const c of this.cities) {
      this.popTotals.set(c.faction, (this.popTotals.get(c.faction) ?? 0) + c.pop);
    }
    this.resetArsenals();
    this.resetCampaign();
  }

  private resetCampaign(): void {
    this.programs = new Map(
      ASPIRANTS.map((f) => [f.id, createProgram(f.id, ASPIRANT_PROFILES[f.id]!)]),
    );
    this.influence = INFLUENCE_START;
    this.elapsed = 0;
    this.campaignAcc = 0;
    this.revealedSeen = new Set();
    this.armedOrder = [];
    this.toolUse = { treaties: 0, sanctions: 0, sabotages: 0, strikes: 0 };
  }

  private resetArsenals(): void {
    this.arsenals = new Map(FACTIONS.map((f) => [f.id, f.arsenal]));
    this.interceptors = new Map(FACTIONS.map((f) => [f.id, DEFENSES[f.id].interceptors]));
    this.launchedBy = new Map();
    this.killedBy = new Map();
    this.interceptedBy = new Map();
  }

  // Продвигает симуляцию на dt секунд, применяя команды этого тика; возвращает
  // все события, произошедшие за тик (в порядке: команды, затем взрывы).
  step(dt: number, commands: Command[]): SimEvent[] {
    const events: SimEvent[] = [];

    // Стартовый снимок сторон — первым событием первого тика: HUD получает население и
    // арсеналы тем же путём, что и все дальнейшие изменения, без отдельного «начального
    // состояния» на его стороне (симуляция остаётся единственным источником истины).
    if (!this.bootstrapped) {
      this.bootstrapped = true;
      events.push(this.factionsEvent());
    }

    for (const cmd of commands) this.applyCommand(cmd, events);
    this.runMissiles(dt, events);
    this.tickRelations(dt);
    this.runCampaign(dt, events);
    this.decayGrievances(dt);
    this.expireOffers(dt, events);
    this.runAi(dt, events);
    this.quietFor += dt;
    this.checkOutcome(events);

    return events;
  }

  private applyCommand(cmd: Command, events: SimEvent[]): void {
    switch (cmd.kind) {
      case 'detonate': {
        assertValidYield(cmd.yield);
        assertValidFaction(cmd.faction);
        const id = this.nextId++;
        const entity = this.world.add({
          warhead: {
            yield: cmd.yield,
            seed: this.rng.int(1_000_000_000),
            t: 0,
            flightTime: FLIGHT_TIME,
            dir: cmd.dir,
            faction: cmd.faction,
          },
        });
        this.ids.set(entity, id);
        if (cmd.faction !== undefined) {
          this.launchedBy.set(cmd.faction, (this.launchedBy.get(cmd.faction) ?? 0) + 1);
        }
        events.push({
          kind: 'missileLaunched',
          id,
          dir: cmd.dir,
          yield: cmd.yield,
          flightTime: FLIGHT_TIME,
          faction: cmd.faction,
        });
        break;
      }
      case 'salvo':
        this.applySalvo(cmd.from, cmd.to, events);
        break;
      case 'setYield':
        assertValidYield(cmd.yield);
        this.currentYield = cmd.yield;
        break;
      case 'setSide':
        assertValidFaction(cmd.faction);
        this.playerSide = cmd.faction;
        break;
      case 'proposeCeasefire':
        assertValidFaction(cmd.from);
        assertValidFaction(cmd.to);
        this.handleProposal(cmd.from, cmd.to, events);
        break;
      case 'ceasefireResponse':
        assertValidFaction(cmd.from);
        assertValidFaction(cmd.to);
        this.answerOffer(cmd.from, cmd.to, cmd.accept, events);
        break;
      case 'offerTreaty':
      case 'imposeSanctions':
      case 'inspect':
      case 'sabotage':
        assertValidFaction(cmd.target);
        this.applyTool(cmd.kind, cmd.target, events);
        break;
      case 'setDoctrine':
        if (!isDoctrine(cmd.doctrine)) {
          throw new Error(`Неизвестная доктрина ответа: ${String(cmd.doctrine)}.`);
        }
        this.doctrine = cmd.doctrine;
        // Выключенная доктрина снимает уже запланированные ответы: «выкл» значит выкл.
        if (this.doctrine === 'off') this.offers = [];
        events.push({ kind: 'doctrineChanged', doctrine: this.doctrine });
        break;
      case 'reset':
        this.applyReset(events);
        break;
      case 'toggleLabels':
        this.labelsEnabled = !this.labelsEnabled;
        events.push({ kind: 'labelsToggled', enabled: this.labelsEnabled });
        break;
    }
  }

  // Случайная точка на суше: rejection sampling равномерных направлений по landmask
  // (детерминированно через Rng). Фолбэк после лимита попыток — последняя точка как есть
  // (реалистично суша находится за 2-3 попытки: её ~29%).
  private randomLandDir(): Vec3 {
    let dir: Vec3 = { x: 1, y: 0, z: 0 };
    for (let i = 0; i < 40; i++) {
      const az = this.rng.range(0, Math.PI * 2);
      const cz = this.rng.range(-1, 1);
      const sxy = Math.sqrt(Math.max(0, 1 - cz * cz));
      dir = { x: sxy * Math.cos(az), y: sxy * Math.sin(az), z: cz };
      if (materialAtDir(dir).surface !== 'water') return dir;
    }
    return dir;
  }

  // Живые города стороны — и цели для удара, и её пусковые площадки.
  private citiesOf(id: FactionId): City[] {
    return this.cities.filter((c) => c.faction === id && c.alive > ALIVE_EPS);
  }

  // Сторона может пускать, если есть боеголовки И есть живой город: пусковые площадки —
  // это её территория, обезглавленная страна арсенал уже не применит (отдельного флага
  // «уничтожена» нет — это следствие, а не состояние).
  private canLaunch(id: FactionId): boolean {
    return (this.arsenals.get(id) ?? 0) > 0 && this.citiesOf(id).length > 0;
  }

  // Агрессор: заданный командой (если способен пускать — подменять чужой выбор молча нельзя),
  // иначе случайная способная сторона; некому — undefined, залп не состоится.
  private pickAttacker(pref?: FactionId): FactionId | undefined {
    if (pref !== undefined) return this.canLaunch(pref) ? pref : undefined;
    const able = BELLIGERENTS.filter((f) => this.canLaunch(f.id));
    return able.length > 0 ? able[this.rng.int(able.length)]!.id : undefined;
  }

  // Цели: живые города заданной стороны; если она задана, но целей у неё нет (или сторона
  // не задана) — случайная ДРУГАЯ воюющая сторона с живыми городами; нет и таких — любые
  // живые города (включая нейтральные); совсем никого — пустой список (фолбэк на точки суши).
  private pickTargets(attacker: FactionId, pref?: FactionId): City[] {
    if (pref !== undefined) {
      const wanted = this.citiesOf(pref);
      if (wanted.length > 0) return wanted;
    }
    const enemies = BELLIGERENTS.filter((f) => f.id !== attacker && this.citiesOf(f.id).length > 0);
    if (enemies.length > 0) return this.citiesOf(enemies[this.rng.int(enemies.length)]!.id);
    return this.cities.filter((c) => c.alive > ALIVE_EPS);
  }

  // Пусковая площадка: точка суши в пределах FACTION_LAUNCH_JITTER от города (ракеты стартуют
  // с территории страны, а не из центра мегаполиса). Вокруг прибрежного города суши может
  // не найтись — тогда общий фолбэк на случайную точку суши, чтобы старт не оказался в море.
  private launchSiteNear(city: Vec3): Vec3 {
    for (let i = 0; i < LAUNCH_SITE_TRIES; i++) {
      const dir = jitterDir(
        city,
        this.rng.range(0, FACTION_LAUNCH_JITTER),
        this.rng.range(0, Math.PI * 2),
      );
      if (materialAtDir(dir).surface !== 'water') return dir;
    }
    return this.randomLandDir();
  }

  // Общий пуск: сторона поднимает count ракет со своей территории по городам из targets,
  // списывая боеголовки. Используется и кнопкой залпа, и ответным ударом. Возвращает,
  // сколько ракет реально поднято (ограничение — арсенал).
  private launchSalvo(
    attacker: FactionId,
    targets: City[],
    count: number,
    events: SimEvent[],
  ): number {
    assertValidYield(this.currentYield);
    const sites = this.citiesOf(attacker);
    const n = Math.max(0, Math.min(count, this.arsenals.get(attacker) ?? 0));
    if (n === 0 || sites.length === 0) return 0;

    for (let i = 0; i < n; i++) {
      const site = sites[this.rng.int(sites.length)]!;
      const launch = this.launchSiteNear(site.dir);
      const target =
        targets.length > 0 ? targets[this.rng.int(targets.length)]!.dir : this.randomLandDir();
      const flightTime = flightTimeFor(angleBetween(launch, target));
      const id = this.nextId++;
      const entity = this.world.add({
        warhead: {
          yield: this.currentYield,
          seed: this.rng.int(1_000_000_000),
          t: 0,
          flightTime,
          dir: target,
          from: launch,
          faction: attacker,
        },
      });
      this.ids.set(entity, id);
      events.push({
        kind: 'missileLaunched',
        id,
        dir: target,
        yield: this.currentYield,
        flightTime,
        from: launch,
        faction: attacker,
      });
    }

    this.arsenals.set(attacker, (this.arsenals.get(attacker) ?? 0) - n);
    this.launchedBy.set(attacker, (this.launchedBy.get(attacker) ?? 0) + n);
    return n;
  }

  // Залп МБР по кнопке (спека 2026-08-29, развитие спеки 2026-07-14): сторона-агрессор
  // пускает min(SALVO_COUNT, арсенал) ракет по живым городам стороны-цели.
  private applySalvo(
    from: FactionId | undefined,
    to: FactionId | undefined,
    events: SimEvent[],
  ): void {
    assertValidYield(this.currentYield);
    assertValidFaction(from);
    assertValidFaction(to);
    const attacker = this.pickAttacker(from);
    if (attacker === undefined) return; // пускать некому — молчаливый no-op (HUD гасит кнопку)

    const targets = this.pickTargets(attacker, to);
    this.launchSalvo(attacker, targets, SALVO_COUNT, events);
    events.push(this.factionsEvent());
  }

  // ---------- Дипломатия: атрибуция удара, планирование и пуск ответа ----------

  // ---- Лестница эскалации: отношения пары сторон (спека 2026-08-29-abm-escalation §3) ----

  private static relKey(a: FactionId, b: FactionId): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private relation(a: FactionId, b: FactionId): Relation {
    const key = Simulation.relKey(a, b);
    let rel = this.relations.get(key);
    if (rel === undefined) {
      rel = { level: 0, quiet: 0, truce: 0, cooldown: 0 };
      this.relations.set(key, rel);
    }
    return rel;
  }

  private levelBetween(a: FactionId, b: FactionId): number {
    return this.relations.get(Simulation.relKey(a, b))?.level ?? 0;
  }

  private inTruce(a: FactionId, b: FactionId): boolean {
    return (this.relations.get(Simulation.relKey(a, b))?.truce ?? 0) > 0;
  }

  // Удар поднимает пару на ступень (не выше потолка доктрины) и ломает перемирие, если было.
  // by — кто именно сорвал перемирие (по умолчанию виновник удара); нужен, потому что
  // эскалацию поднимают обе стороны: и жертва по факту прилёта, и агрессор по факту пуска.
  private escalate(
    victim: FactionId,
    blame: FactionId,
    events: SimEvent[],
    by: FactionId = blame,
  ): number {
    const rel = this.relation(victim, blame);
    if (rel.truce > 0) {
      rel.truce = 0;
      events.push({ kind: 'truceBroken', by, against: by === victim ? blame : victim });
    }
    rel.level = Math.min(doctrineCeiling(this.doctrine), rel.level + 1);
    rel.quiet = 0;
    this.warHappened = true;
    return rel.level;
  }

  // Ход времени в отношениях: затишье снижает накал, перемирия и паузы переговоров тают.
  private tickRelations(dt: number): void {
    for (const rel of this.relations.values()) {
      rel.truce = Math.max(0, rel.truce - dt);
      rel.cooldown = Math.max(0, rel.cooldown - dt);
      rel.quiet += dt;
      if (rel.level > 0 && rel.quiet >= ESCALATION_DECAY_T) {
        rel.level -= 1;
        rel.quiet = 0;
      }
    }
  }

  // ---- Переговоры ----

  // Истёкшие предложения перемирия: молчание дольше PEACE_OFFER_TIMEOUT — отказ. Правило одно
  // и для игрока, и для ИИ: предложение всегда ложится «на стол» и ждёт решения (спека §6).
  private expireOffers(dt: number, events: SimEvent[]): void {
    for (const offer of [...this.offers]) {
      offer.t -= dt;
      if (offer.t > 0) continue;
      this.offers = this.offers.filter((o) => o !== offer);
      events.push({ kind: 'ceasefireRejected', from: offer.from, to: offer.to });
    }
  }

  // Обиды тают: за GRIEVANCE_HALFLIFE секунд вдвое. Без забывания мир навсегда застревает в
  // состоянии «все всем должны» — и ни одна страна уже не согласится на мир.
  private decayGrievances(dt: number): void {
    const factor = Math.pow(0.5, dt / GRIEVANCE_HALFLIFE);
    for (const [key, value] of this.grievances) {
      const next = value * factor;
      if (next < 0.001) this.grievances.delete(key);
      else this.grievances.set(key, next);
    }
  }

  private grievanceOf(victim: FactionId, offender: FactionId): number {
    return this.grievances.get(`${victim}<${offender}`) ?? 0;
  }

  private addGrievance(victim: FactionId, offender: FactionId, deaths: number): void {
    const key = `${victim}<${offender}`;
    this.grievances.set(key, (this.grievances.get(key) ?? 0) + deaths);
  }

  // Предложение перемирия всегда ложится «на стол» и ждёт решения: игрок отвечает кнопкой,
  // ИИ-сторона — действием acceptPeace на своём пульсе. Единый путь для обоих (спека §6).
  private handleProposal(from: FactionId, to: FactionId, events: SimEvent[]): void {
    if (from === to) return;
    const rel = this.relation(from, to);
    if (rel.truce > 0) return; // уже мир
    if (this.offers.some((o) => o.from === from && o.to === to)) return; // уже предложено
    rel.cooldown = PEACE_COOLDOWN_T;
    this.offers.push({ from, to, t: PEACE_OFFER_TIMEOUT });
    events.push({ kind: 'ceasefireProposed', from, to, forPlayer: to === this.playerSide });
  }

  // Ответ на предложение (игрока или ИИ). Согласие обнуляет накал, даёт перемирие и снимает
  // уже запланированные ответы этой пары — иначе «мир» тут же сорвётся своей же ракетой.
  private answerOffer(from: FactionId, to: FactionId, accept: boolean, events: SimEvent[]): void {
    this.offers = this.offers.filter((o) => !(o.from === from && o.to === to));
    if (!accept) {
      events.push({ kind: 'ceasefireRejected', from, to });
      return;
    }
    const rel = this.relation(from, to);
    rel.level = 0;
    rel.truce = TRUCE_T;
    rel.quiet = 0;
    events.push({ kind: 'ceasefireAccepted', from, to });
    events.push(this.factionsEvent());
  }

  // Кого винить за удар: явную сторону боеголовки, а при анонимном ударе (ручной клик без
  // выбранной стороны) — случайную ДРУГУЮ воюющую сторону. Это сознательная механика
  // песочницы: анонимный удар всё равно раскручивает мир (спека §2).
  private blameFor(victim: FactionId, attacker: FactionId | undefined): FactionId | undefined {
    if (attacker !== undefined) return attacker === victim ? undefined : attacker;
    const suspects = BELLIGERENTS.filter((f) => f.id !== victim);
    return suspects.length > 0 ? suspects[this.rng.int(suspects.length)]!.id : undefined;
  }

  // Разбор последствий взрыва: жертва — сторона с наибольшими потерями (нейтральные не
  // воюют). Здесь только УЧЁТ: поднимаем ступень эскалации и копим обиду. Что с этим делать —
  // решает сторона на своём пульсе (спека 2026-08-29-utility-ai §6: очередь ответов удалена).
  private registerStrike(
    hits: CasualtyHit[],
    attacker: FactionId | undefined,
    events: SimEvent[],
  ): void {
    if (hits.length === 0) return;

    const deathsBy = new Map<FactionId, number>();
    for (const h of hits) {
      if (h.faction === 'neutral') continue; // нейтральным нечем и некому отвечать
      deathsBy.set(h.faction, (deathsBy.get(h.faction) ?? 0) + h.deaths);
    }
    let victim: FactionId | undefined;
    let worst = 0;
    for (const [id, deaths] of deathsBy) {
      if (deaths > worst) {
        worst = deaths;
        victim = id;
      }
    }
    if (victim === undefined || worst <= ALIVE_EPS) return;

    // Удар по стране с программой отбрасывает её работы на стадию назад — и злит.
    const program = this.programs.get(victim);
    if (program !== undefined && program.stage !== 'none' && program.stage !== 'armed') {
      setbackByStrike(program);
      program.motivation = Math.min(1, program.motivation + 0.25);
      program.suspicion = 1;
      this.toolUse.strikes += 1;
      if (attacker !== undefined && attacker === this.playerSide) {
        this.influence = Math.max(0, this.influence - INFLUENCE_STRIKE_PENALTY);
      }
    }

    const blame = this.blameFor(victim, attacker);
    if (blame === undefined) return; // сам себе счёт никто не выставляет
    this.escalate(victim, blame, events);
    this.addGrievance(victim, blame, worst);
  }

  // ---------- Кампания «Нераспространение» (спека 2026-08-29-nonproliferation) ----------

  // Насколько стране страшно жить: накал вокруг неё и свежие потери от чужих ударов.
  private threatFor(id: FactionId): number {
    let heat = 0;
    for (const f of BELLIGERENTS) {
      if (f.id === id) continue;
      heat = Math.max(heat, this.levelBetween(id, f.id) / ESCALATION_MAX);
      const grievance = this.grievanceOf(id, f.id);
      heat = Math.max(heat, Math.min(1, grievance / AI_GRIEVANCE_REF));
    }
    return heat;
  }

  // Тик программ: прогресс, мотивация, испытания, доход влияния и секундный снимок для HUD.
  private runCampaign(dt: number, events: SimEvent[]): void {
    this.elapsed += dt;
    this.influence = Math.min(999, this.influence + INFLUENCE_RATE * dt);

    for (const program of this.programs.values()) {
      const base = ASPIRANT_PROFILES[program.id]!.motivation;
      program.motivation = motivationDrift(program, base, this.threatFor(program.id), dt);
      const tested = advanceProgram(program, dt);

      if (!this.revealedSeen.has(program.id) && isRevealed(program) && program.stage !== 'armed') {
        this.revealedSeen.add(program.id);
        events.push({ kind: 'programRevealed', faction: program.id, stage: program.stage });
      }
      if (tested) this.armCountry(program, events);
    }

    this.campaignAcc += dt;
    if (this.campaignAcc >= 1) {
      this.campaignAcc = 0;
      events.push({
        kind: 'campaignChanged',
        influence: this.influence,
        elapsed: this.elapsed,
        programs: [...this.programs.values()].map((p) => this.programView(p)),
      });
    }
  }

  // Испытание: страна становится ядерной державой — получает арсенал, ПРО и место в войне.
  // Чужая бомба подстёгивает всех остальных: это и есть каскад распространения.
  private armCountry(program: Program, events: SimEvent[]): void {
    this.armedOrder.push(program.id);
    this.arsenals.set(program.id, NEW_POWER_ARSENAL);
    this.interceptors.set(program.id, NEW_POWER_INTERCEPTORS);
    events.push({ kind: 'nuclearTest', faction: program.id });
    for (const other of this.programs.values()) {
      if (other.id === program.id || other.stage === 'armed') continue;
      other.motivation = Math.min(1, other.motivation + CASCADE_MOTIVATION);
    }
    events.push(this.factionsEvent());
  }

  // То, что игрок ЗНАЕТ о программе: до порога подозрения стадия и прогресс скрыты.
  private programView(p: Program) {
    const revealed = isRevealed(p);
    return {
      id: p.id,
      revealed,
      stage: revealed ? p.stage : ('none' as const),
      progress: revealed ? totalProgress(p) : 0,
      motivation: p.motivation,
      suspicion: p.suspicion,
      sanctions: p.sanctions > 0,
      treaty: p.treaty > 0,
    };
  }

  // Инструменты игрока. Каждый стоит влияния; не хватает — команда молча не проходит
  // (HUD гасит кнопку, но сеть/скрипт могут прислать что угодно).
  private applyTool(
    kind: 'offerTreaty' | 'imposeSanctions' | 'inspect' | 'sabotage',
    target: FactionId,
    events: SimEvent[],
  ): void {
    const program = this.programs.get(target);
    if (program === undefined) return; // цель не претендент
    const cost =
      kind === 'offerTreaty'
        ? COST_TREATY
        : kind === 'imposeSanctions'
          ? COST_SANCTIONS
          : kind === 'inspect'
            ? COST_INSPECT
            : COST_SABOTAGE;
    if (this.influence < cost) return;
    this.influence -= cost;

    switch (kind) {
      case 'offerTreaty': {
        this.toolUse.treaties += 1;
        const accepted = this.rng.next() < treatyAcceptance(program);
        if (accepted) {
          program.treaty = TREATY_T;
          program.motivation = Math.max(0, program.motivation - 0.2);
        } else {
          program.motivation = Math.min(1, program.motivation + 0.05); // давление обижает
        }
        events.push({ kind: 'treatyAnswer', faction: target, accepted });
        break;
      }
      case 'imposeSanctions':
        this.toolUse.sanctions += 1;
        program.sanctions = SANCTION_T;
        program.motivation = Math.min(1, program.motivation + 0.08);
        events.push({ kind: 'sanctionsImposed', faction: target });
        break;
      case 'inspect':
        program.suspicion = 1;
        this.revealedSeen.add(target);
        setbackByFraction(program, 0.05);
        events.push({ kind: 'inspected', faction: target, stage: program.stage });
        break;
      case 'sabotage': {
        this.toolUse.sabotages += 1;
        const success = this.rng.next() < SABOTAGE_SUCCESS;
        if (success) {
          setbackByFraction(program, this.rng.range(SABOTAGE_SETBACK_MIN, SABOTAGE_SETBACK_MAX));
        } else {
          // Провал раскрывает исполнителя: мотивация скачком и ссора с игроком.
          program.motivation = Math.min(1, program.motivation + 0.15);
          if (this.playerSide !== undefined) this.escalate(target, this.playerSide, events);
        }
        events.push({ kind: 'sabotageResult', faction: target, success });
        break;
      }
    }
    events.push({
      kind: 'campaignChanged',
      influence: this.influence,
      elapsed: this.elapsed,
      programs: [...this.programs.values()].map((p) => this.programView(p)),
    });
  }

  // ---------- Слой решений (Utility AI, спека 2026-08-29-utility-ai-design.md) ----------

  // Контекст решения — снимок того, что сторона знает о мире. Пока данные точные; когда
  // появится разведка, зашумлять надо будет только здесь.
  private contextFor(id: FactionId): DecisionContext {
    const self = FACTIONS.find((f) => f.id === id)!;
    const cities = this.cities.filter((c) => c.faction === id);
    const popAlive = cities.reduce((sum, c) => sum + Math.max(0, c.alive), 0);
    const popTotal = this.popTotals.get(id) ?? 1;
    const allies = alliesOf(id);

    const rivals: RivalView[] = BELLIGERENTS.filter((f) => f.id !== id).map((f) => {
      const rivalCities = this.cities.filter((c) => c.faction === f.id);
      const rivalTotal = this.popTotals.get(f.id) ?? 1;
      const rivalAlive = rivalCities.reduce((sum, c) => sum + Math.max(0, c.alive), 0);
      // «Союзника бьют»: максимальная ступень пары «мой союзник ↔ эта сторона».
      let allyHeat = 0;
      for (const ally of allies) allyHeat = Math.max(allyHeat, this.levelBetween(ally, f.id));
      return {
        id: f.id,
        level: this.levelBetween(id, f.id),
        truce: this.inTruce(id, f.id),
        arsenal: this.arsenals.get(f.id) ?? 0,
        interceptorsFrac:
          (this.interceptors.get(f.id) ?? 0) / Math.max(1, DEFENSES[f.id].interceptors),
        popAliveFrac: rivalAlive / rivalTotal,
        citiesAlive: rivalCities.filter((c) => c.alive > ALIVE_EPS).length,
        grievance: this.grievanceOf(id, f.id),
        offerFromThem: this.offers.some((o) => o.from === f.id && o.to === id),
        offerPending: this.offers.some(
          (o) => (o.from === f.id && o.to === id) || (o.from === id && o.to === f.id),
        ),
        peaceCooldown: (this.relations.get(Simulation.relKey(id, f.id))?.cooldown ?? 0) > 0,
        ally: allies.includes(f.id),
        allyHeat,
      };
    });

    return {
      self: {
        id,
        temperament: TEMPERAMENTS[id],
        arsenal: this.arsenals.get(id) ?? 0,
        arsenalFrac: (this.arsenals.get(id) ?? 0) / Math.max(1, self.arsenal),
        interceptorsFrac: (this.interceptors.get(id) ?? 0) / Math.max(1, DEFENSES[id].interceptors),
        damageFrac: 1 - popAlive / popTotal,
        citiesAlive: cities.filter((c) => c.alive > ALIVE_EPS).length,
        sinceStrike: this.aiClock - (this.lastStrikeAt.get(id) ?? -1e6),
      },
      rivals,
      doctrine: this.doctrine,
      ceiling: doctrineCeiling(this.doctrine),
    };
  }

  // Пульс раздумий: стороны разнесены по фазам (страна i думает со смещением i/N·AI_PULSE_T),
  // поэтому один тик никогда не считает решения всех сразу. Пульс же даёт естественную
  // задержку реакции 0..AI_PULSE_T секунд — отдельный таймер ответа больше не нужен.
  private runAi(dt: number, events: SimEvent[]): void {
    if (this.doctrine === 'off') return;
    this.aiClock += dt;
    const n = BELLIGERENTS.length;
    for (let i = 0; i < n; i++) {
      const id = BELLIGERENTS[i]!.id;
      // За сторону игрока решает игрок: её удары, договоры и ответы идут только командами.
      if (id === this.playerSide) continue;
      const phase = (i / n) * AI_PULSE_T;
      const slot = Math.floor((this.aiClock - phase) / AI_PULSE_T);
      if (slot < 0 || slot === this.lastPulse.get(id)) continue;
      this.lastPulse.set(id, slot);
      this.think(id, events);
    }
  }

  private think(id: FactionId, events: SimEvent[]): void {
    const ctx = this.contextFor(id);
    const decision = decide(ctx, this.rng, this.lastChoice.get(id));
    this.lastChoice.set(id, { action: decision.action, target: decision.target });
    events.push({
      kind: 'decisionMade',
      faction: id,
      action: decision.action,
      target: decision.target,
      score: decision.score,
      top: decision.top,
    });
    this.execute(id, decision.action, decision.target, ctx, events);
  }

  // Исполнение решения существующими механизмами: удары — через launchSalvo, переговоры —
  // через handleProposal/answerOffer. Новой боевой логики слой решений не приносит.
  private execute(
    id: FactionId,
    action: Decision['action'],
    target: FactionId | undefined,
    ctx: DecisionContext,
    events: SimEvent[],
  ): void {
    if (action === 'wait' || target === undefined) return;
    const rival = ctx.rivals.find((r) => r.id === target);
    if (rival === undefined) return;

    if (action === 'proposePeace') {
      this.handleProposal(id, target, events);
      return;
    }
    if (action === 'acceptPeace') {
      this.answerOffer(target, id, true, events);
      return;
    }

    const size = actionSize(action, ctx, rival);
    if (size <= 0 || !this.canLaunch(id)) return;
    const targets = this.citiesOf(target).length > 0 ? this.citiesOf(target) : this.pickTargets(id);
    const launched = this.launchSalvo(id, targets, size, events);
    if (launched === 0) return;
    this.lastStrikeAt.set(id, this.aiClock);
    // Месть удовлетворяет: каждая выпущенная боеголовка гасит часть счёта к этой стороне,
    // иначе один удар кормит бесконечную череду ответов.
    const settled = launched * GRIEVANCE_SETTLED_PER_WARHEAD;
    const key = `${id}<${target}`;
    this.grievances.set(key, Math.max(0, (this.grievances.get(key) ?? 0) - settled));
    // Пуск — это тоже эскалация: атакующий поднимает ступень, не дожидаясь прилёта.
    this.escalate(id, target, events, id);
    events.push({
      kind: 'retaliationLaunched',
      from: id,
      to: target,
      count: launched,
      action,
    });
    events.push(this.factionsEvent());
  }

  // Снимок изменяемого состояния сторон для HUD (статику он берёт из sim/factions.ts).
  private factionsEvent(): SimEvent {
    const stats: FactionStat[] = FACTIONS.map((f) => ({
      id: f.id,
      popAlive: 0,
      citiesAlive: 0,
      arsenal: this.arsenals.get(f.id) ?? 0,
      interceptors: this.interceptors.get(f.id) ?? 0,
      enemies: this.enemiesOf(f.id),
    }));
    const byId = new Map(stats.map((s) => [s.id, s]));
    for (const c of this.cities) {
      const s = byId.get(c.faction);
      if (!s) continue;
      s.popAlive += Math.max(0, c.alive);
      if (c.alive > ALIVE_EPS) s.citiesAlive += 1;
    }
    return { kind: 'factionsChanged', factions: stats };
  }

  // С кем сторона в конфликте: пары с ненулевым уровнем или действующим перемирием.
  private enemiesOf(id: FactionId): { id: FactionId; level: number; truce: boolean }[] {
    const out: { id: FactionId; level: number; truce: boolean }[] = [];
    for (const [key, rel] of this.relations) {
      if (rel.level <= 0 && rel.truce <= 0) continue;
      const [a, b] = key.split('|') as [FactionId, FactionId];
      if (a !== id && b !== id) continue;
      out.push({ id: a === id ? b : a, level: rel.level, truce: rel.truce > 0 });
    }
    return out;
  }

  private applyReset(events: SimEvent[]): void {
    // Убираем боеголовки в полёте и воскрешаем города.
    for (const entity of [...this.world.with('warhead')]) this.world.remove(entity);
    this.cities = createCities();
    this.resetArsenals();
    this.resetCampaign();
    this.grievances.clear(); // память обид обнуляется вместе с войной
    this.lastChoice.clear();
    this.lastPulse.clear();
    this.lastStrikeAt.clear();
    this.aiClock = 0;
    this.relations = new Map();
    this.offers = [];
    this.warHappened = false;
    this.quietFor = 0;
    this.outcome = undefined;
    this.bombs = 0;
    this.megatons = 0;
    this.totalDeaths = 0;
    events.push({ kind: 'planetReset' });
    events.push({ kind: 'statsChanged', bombs: 0, megatons: 0, deaths: 0 });
    events.push(this.factionsEvent());
  }

  // ---- ПРО ----

  // Одна попытка перехвата на боеголовку, на ABM_INTERCEPT_AT её полёта. Перехватывает
  // сторона, чей живой город ближе всего к цели (ПРО прикрывает свою территорию); свои
  // ракеты никто не сбивает. Перехватчик тратится и при промахе — залпом оборону насыщают.
  // Возвращает true, если боеголовка сбита (её больше нет).
  private tryIntercept(entity: Entity, events: SimEvent[]): boolean {
    const w = entity.warhead;
    if (w === undefined || w.abmTried) return false;
    if (w.t < w.flightTime * ABM_INTERCEPT_AT) return false;
    w.abmTried = true;

    const defender = defenderFor(
      this.cities.filter((c) => c.alive > ALIVE_EPS),
      w.dir,
    );
    if (defender === undefined || defender === 'neutral' || defender === w.faction) return false;
    const left = this.interceptors.get(defender) ?? 0;
    if (left <= 0) return false;
    this.interceptors.set(defender, left - 1);

    const k = Math.min(1, w.t / w.flightTime);
    const pos = w.from ? ballisticPos(w.from, w.dir, k) : spaceStrikePos(w.dir, k);
    const success = this.rng.next() < interceptChance(defender);
    const id = this.ids.get(entity) ?? 0;
    events.push({ kind: 'interception', id, by: defender, pos, success });

    if (success) {
      this.interceptedBy.set(defender, (this.interceptedBy.get(defender) ?? 0) + 1);
      this.ids.delete(entity);
      this.world.remove(entity);
    }
    events.push(this.factionsEvent()); // перехватчиков стало меньше
    return success;
  }

  // ---- Итоги партии ----

  // Снимок сторон для условий победы (нейтральные не воюют и в оценке не участвуют).
  private sideSnapshots(): SideSnapshot[] {
    return BELLIGERENTS.map((f) => {
      const cities = this.cities.filter((c) => c.faction === f.id);
      return {
        id: f.id,
        popAlive: cities.reduce((sum, c) => sum + Math.max(0, c.alive), 0),
        popTotal: this.popTotals.get(f.id) ?? 0,
        arsenal: this.arsenals.get(f.id) ?? 0,
        citiesAlive: cities.filter((c) => c.alive > ALIVE_EPS).length,
      };
    });
  }

  // Проверяет условия победы; исход объявляется один раз за партию (до reset).
  private checkOutcome(events: SimEvent[]): void {
    if (this.outcome !== undefined) return;
    const atPeace = [...this.relations.values()].every((r) => r.level <= 0 || r.truce > 0);
    const result = evaluateOutcome(this.sideSnapshots(), {
      armedCount: this.armedOrder.length,
      elapsed: this.elapsed,
      campaignT: CAMPAIGN_T,
      lossCount: PROLIF_LOSS_COUNT,
      warHappened: this.warHappened,
      missilesInFlight: [...this.world.with('warhead')].length,
      atPeace,
      quietFor: this.quietFor,
      peaceHoldT: PEACE_HOLD_T,
    });
    if (result === undefined) return;
    this.outcome = result.outcome;
    events.push({
      kind: 'gameOver',
      outcome: result.outcome,
      winner: result.winner,
      summary: this.summary(),
      campaign: {
        elapsed: this.elapsed,
        armed: [...this.armedOrder],
        stopped: ASPIRANTS.length - this.armedOrder.length,
        treaties: this.toolUse.treaties,
        sanctions: this.toolUse.sanctions,
        sabotages: this.toolUse.sabotages,
        strikes: this.toolUse.strikes,
        influence: Math.round(this.influence),
      },
    });
  }

  private summary(): SideSummary[] {
    return this.sideSnapshots().map((s) => ({
      id: s.id,
      popAlive: s.popAlive,
      popTotal: s.popTotal,
      killed: this.killedBy.get(s.id) ?? 0,
      launched: this.launchedBy.get(s.id) ?? 0,
      intercepted: this.interceptedBy.get(s.id) ?? 0,
      arsenal: s.arsenal,
      interceptors: this.interceptors.get(s.id) ?? 0,
    }));
  }

  // Продвигает полёт боеголовок; по прилёте — взрыв, расчёт жертв, обновление статистики.
  private runMissiles(dt: number, events: SimEvent[]): void {
    for (const entity of [...this.world.with('warhead')]) {
      const w = entity.warhead;
      w.t += dt;
      // ПРО отрабатывает на подлёте — до детонации (спека 2026-08-29-abm-escalation §2).
      if (this.tryIntercept(entity, events)) continue;
      if (w.t < w.flightTime) continue;

      const id = this.ids.get(entity) ?? 0;
      this.ids.delete(entity);
      this.world.remove(entity);

      // Инвариант: w.yield провалидирован в applyCommand при создании боеголовки
      // (assertValidYield в кейсе 'detonate'), поэтому здесь каст безопасен.
      // Повторная проверка — защита от будущих путей создания warhead в обход applyCommand.
      assertValidYield(w.yield);
      const ts = TS_TABLE[w.yield];
      const { hits, totalDeaths } = computeCasualties(this.cities, w.dir, w.yield, ts);
      this.registerStrike(hits, w.faction, events); // кто пострадал → кто и когда ответит
      this.quietFor = 0; // взрыв обнуляет отсчёт тишины (условие «мир восстановлен»)
      if (w.faction !== undefined) {
        this.killedBy.set(w.faction, (this.killedBy.get(w.faction) ?? 0) + totalDeaths);
      }

      const { surface, biome } = materialAtDir(w.dir);
      events.push({
        kind: 'explosionStarted',
        id,
        dir: w.dir,
        yield: w.yield,
        seed: w.seed,
        surface,
        biome,
      });
      for (const h of hits) {
        events.push({
          kind: 'cityHit',
          name: h.name,
          deaths: h.deaths,
          atWaveTime: h.atWaveTime,
          faction: h.faction,
          alive: h.alive,
        });
      }

      this.bombs += 1;
      this.megatons += w.yield;
      this.totalDeaths += totalDeaths;
      events.push({
        kind: 'statsChanged',
        bombs: this.bombs,
        megatons: this.megatons,
        deaths: this.totalDeaths,
      });
      if (hits.length > 0) events.push(this.factionsEvent()); // население сторон изменилось
    }
  }

  // Снимок состояния для отладки/сериализации (не участвует в геймплейной логике).
  snapshot(): unknown {
    return {
      cities: this.cities.map((c) => ({ name: c.name, alive: c.alive, faction: c.faction })),
      arsenals: Object.fromEntries(this.arsenals),
      bombs: this.bombs,
      megatons: this.megatons,
      totalDeaths: this.totalDeaths,
      currentYield: this.currentYield,
      doctrine: this.doctrine,
      outcome: this.outcome,
      relations: Object.fromEntries([...this.relations].map(([k, r]) => [k, { ...r }])),
      interceptors: Object.fromEntries(this.interceptors),
      influence: Math.round(this.influence),
      elapsed: Math.round(this.elapsed),
      programs: Object.fromEntries(
        [...this.programs].map(([k, p]) => [k, { stage: p.stage, progress: totalProgress(p) }]),
      ),
      labelsEnabled: this.labelsEnabled,
    };
  }
}
