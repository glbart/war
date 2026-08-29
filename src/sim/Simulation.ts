import { Rng } from '../core/time';
import { createWorld } from '../ecs/world';
import type { Entity } from '../ecs/components';
import { computeCasualties } from '../ecs/systems/CasualtySystem';
import { createCities, type City } from './cities';
import type { Command } from './commands';
import type { SimEvent, FactionStat } from './events';
import { YIELDS, SALVO_COUNT, FACTION_LAUNCH_JITTER, type Yield } from '../assets/config';
import { materialAtDir } from './material';
import { angleBetween, jitterDir, type Vec3 } from './geo';
import { flightTimeFor } from './ballistics';
import { FACTIONS, BELLIGERENTS, isFactionId, type FactionId } from './factions';

// Время полёта боеголовки до детонации, сек (порт таймингов демо).
const FLIGHT_TIME = 2.6;

// Порог «город ещё жив» — тот же, по которому CasualtySystem пропускает опустошённые города.
const ALIVE_EPS = 0.001;

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

    for (const cmd of commands) this.applyCommand(cmd, events);
    this.runMissiles(dt, events);

    return events;
  }

  private applyCommand(cmd: Command, events: SimEvent[]): void {
    switch (cmd.kind) {
      case 'detonate': {
        assertValidYield(cmd.yield);
        const id = this.nextId++;
        const entity = this.world.add({
          warhead: {
            yield: cmd.yield,
            seed: this.rng.int(1_000_000_000),
            t: 0,
            flightTime: FLIGHT_TIME,
            dir: cmd.dir,
          },
        });
        this.ids.set(entity, id);
        events.push({
          kind: 'missileLaunched',
          id,
          dir: cmd.dir,
          yield: cmd.yield,
          flightTime: FLIGHT_TIME,
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

  // Залп МБР (спека 2026-08-29, развитие спеки 2026-07-14): сторона-агрессор пускает
  // min(SALVO_COUNT, арсенал) ракет со своей территории по живым городам стороны-цели,
  // тратя боеголовки. Мощность — текущая выбранная (setYield); время полёта — от дальности.
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

    const sites = this.citiesOf(attacker);
    const targets = this.pickTargets(attacker, to);
    const count = Math.min(SALVO_COUNT, this.arsenals.get(attacker) ?? 0);

    for (let i = 0; i < count; i++) {
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

    this.arsenals.set(attacker, (this.arsenals.get(attacker) ?? 0) - count);
    events.push(this.factionsEvent());
  }

  // Снимок изменяемого состояния сторон для HUD (статику он берёт из sim/factions.ts).
  private factionsEvent(): SimEvent {
    const stats: FactionStat[] = FACTIONS.map((f) => ({
      id: f.id,
      popAlive: 0,
      citiesAlive: 0,
      arsenal: this.arsenals.get(f.id) ?? 0,
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
      labelsEnabled: this.labelsEnabled,
    };
  }
}
