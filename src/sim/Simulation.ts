import { Rng } from '../core/time';
import { createWorld } from '../ecs/world';
import type { Entity } from '../ecs/components';
import { computeCasualties, type CasualtyHit } from '../ecs/systems/CasualtySystem';
import { createCities, type City } from './cities';
import type { Command } from './commands';
import type { SimEvent, FactionStat } from './events';
import {
  YIELDS,
  SALVO_COUNT,
  FACTION_LAUNCH_JITTER,
  RETALIATION_DELAY_MIN,
  RETALIATION_DELAY_MAX,
  ALLY_DELAY_EXTRA_MIN,
  ALLY_DELAY_EXTRA_MAX,
  type Yield,
} from '../assets/config';
import { materialAtDir } from './material';
import { angleBetween, jitterDir, type Vec3 } from './geo';
import { flightTimeFor } from './ballistics';
import { FACTIONS, BELLIGERENTS, isFactionId, type FactionId } from './factions';
import { alliesOf, responseSize, isDoctrine, DEFAULT_DOCTRINE, type Doctrine } from './diplomacy';

// Время полёта боеголовки до детонации, сек (порт таймингов демо).
const FLIGHT_TIME = 2.6;

// Порог «город ещё жив» — тот же, по которому CasualtySystem пропускает опустошённые города.
const ALIVE_EPS = 0.001;

// Запланированный ответный удар стороны (спека 2026-08-29-retaliation): пока идёт реакция,
// новые попадания добавляют погибших в ту же запись, а не плодят отдельные волны.
interface Retaliation {
  t: number; // сек до пуска
  grievance: number; // накопленные потери (млн) — из них считается размер ответа
  target: FactionId; // кому мстим
  ally: boolean; // вступаемся за союзника (ответ вполовину меньше)
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
  private readonly pending = new Map<FactionId, Retaliation>();
  private wars = new Map<FactionId, Set<FactionId>>();

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.cities = createCities();
    this.resetArsenals();
  }

  private resetArsenals(): void {
    this.arsenals = new Map(FACTIONS.map((f) => [f.id, f.arsenal]));
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
    this.runRetaliations(dt, events);

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
      case 'setDoctrine':
        if (!isDoctrine(cmd.doctrine)) {
          throw new Error(`Неизвестная доктрина ответа: ${String(cmd.doctrine)}.`);
        }
        this.doctrine = cmd.doctrine;
        // Выключенная доктрина снимает уже запланированные ответы: «выкл» значит выкл.
        if (this.doctrine === 'off') this.pending.clear();
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

  // Помечает пару сторон воюющими (симметрично). Состояние живёт до reset.
  private declareWar(a: FactionId, b: FactionId): void {
    if (a === b) return;
    if (!this.wars.has(a)) this.wars.set(a, new Set());
    if (!this.wars.has(b)) this.wars.set(b, new Set());
    this.wars.get(a)!.add(b);
    this.wars.get(b)!.add(a);
  }

  // Кого винить за удар: явную сторону боеголовки, а при анонимном ударе (ручной клик без
  // выбранной стороны) — случайную ДРУГУЮ воюющую сторону. Это сознательная механика
  // песочницы: анонимный удар всё равно раскручивает мир (спека §2).
  private blameFor(victim: FactionId, attacker: FactionId | undefined): FactionId | undefined {
    if (attacker !== undefined) return attacker === victim ? undefined : attacker;
    const suspects = BELLIGERENTS.filter((f) => f.id !== victim);
    return suspects.length > 0 ? suspects[this.rng.int(suspects.length)]!.id : undefined;
  }

  // Ставит/дополняет запланированный ответ стороны. Повторные попадания в окне реакции
  // копят обиду в ТОЙ ЖЕ записи (залп из шести ракет = один ответ, а не шесть) и не
  // отодвигают срок; прямая месть перебивает статус «вступаюсь за союзника».
  private schedule(
    id: FactionId,
    target: FactionId,
    grievance: number,
    ally: boolean,
    delay: number,
  ): void {
    const cur = this.pending.get(id);
    if (cur === undefined) {
      this.pending.set(id, { t: delay, grievance, target, ally });
      return;
    }
    cur.grievance += grievance;
    cur.target = target;
    cur.ally = cur.ally && ally;
    cur.t = Math.min(cur.t, delay);
  }

  // Разбор последствий взрыва: жертва — сторона с наибольшими потерями (нейтральные не
  // отвечают — у них нет арсенала). Планируем её ответ и вступление союзников.
  private registerStrike(hits: CasualtyHit[], attacker: FactionId | undefined): void {
    if (this.doctrine === 'off' || hits.length === 0) return;

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

    const blame = this.blameFor(victim, attacker);
    if (blame === undefined) return; // сам себя бомбить в ответ никто не станет
    this.declareWar(victim, blame);

    const delay = this.rng.range(RETALIATION_DELAY_MIN, RETALIATION_DELAY_MAX);
    this.schedule(victim, blame, worst, false, delay);
    // Союзники вступаются позже и меньшими силами (responseSize учитывает признак ally).
    // За союзника не воюют ПРОТИВ своего же союзника: если жертву задел собственный блок
    // (например, накрыло соседние города при ударе по чужой стране), отвечает только сама
    // жертва — блок не рвётся на части из-за чужого промаха.
    for (const ally of alliesOf(victim)) {
      if (ally === blame || alliesOf(ally).includes(blame)) continue;
      const extra = this.rng.range(ALLY_DELAY_EXTRA_MIN, ALLY_DELAY_EXTRA_MAX);
      this.schedule(ally, blame, worst, true, delay + extra);
    }
  }

  // Тик отложенных ответов: у кого истёк срок реакции — поднимает волну по обидчику.
  private runRetaliations(dt: number, events: SimEvent[]): void {
    let changed = false;
    for (const [id, plan] of [...this.pending]) {
      plan.t -= dt;
      if (plan.t > 0) continue;
      this.pending.delete(id);
      if (this.doctrine === 'off' || !this.canLaunch(id)) continue;

      const arsenal = this.arsenals.get(id) ?? 0;
      const size = responseSize(plan.grievance, arsenal, this.doctrine, plan.ally);
      if (size <= 0) continue;
      // Цели обидчика могли кончиться, пока шла реакция, — тогда общий выбор целей.
      const targets =
        this.citiesOf(plan.target).length > 0 ? this.citiesOf(plan.target) : this.pickTargets(id);
      const launched = this.launchSalvo(id, targets, size, events);
      if (launched === 0) continue;
      events.push({
        kind: 'retaliationLaunched',
        from: id,
        to: plan.target,
        count: launched,
        reason: plan.ally ? 'ally' : 'revenge',
      });
      changed = true;
    }
    if (changed) events.push(this.factionsEvent());
  }

  // Снимок изменяемого состояния сторон для HUD (статику он берёт из sim/factions.ts).
  private factionsEvent(): SimEvent {
    const stats: FactionStat[] = FACTIONS.map((f) => ({
      id: f.id,
      popAlive: 0,
      citiesAlive: 0,
      arsenal: this.arsenals.get(f.id) ?? 0,
      enemies: [...(this.wars.get(f.id) ?? [])],
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

  private applyReset(events: SimEvent[]): void {
    // Убираем боеголовки в полёте и воскрешаем города.
    for (const entity of [...this.world.with('warhead')]) this.world.remove(entity);
    this.cities = createCities();
    this.resetArsenals();
    this.pending.clear(); // запланированные ответы отменяются вместе с войной
    this.wars = new Map();
    this.bombs = 0;
    this.megatons = 0;
    this.totalDeaths = 0;
    events.push({ kind: 'planetReset' });
    events.push({ kind: 'statsChanged', bombs: 0, megatons: 0, deaths: 0 });
    events.push(this.factionsEvent());
  }

  // Продвигает полёт боеголовок; по прилёте — взрыв, расчёт жертв, обновление статистики.
  private runMissiles(dt: number, events: SimEvent[]): void {
    for (const entity of [...this.world.with('warhead')]) {
      const w = entity.warhead;
      w.t += dt;
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
      this.registerStrike(hits, w.faction); // кто пострадал → кто и когда ответит

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
      wars: Object.fromEntries([...this.wars].map(([k, v]) => [k, [...v]])),
      labelsEnabled: this.labelsEnabled,
    };
  }
}
