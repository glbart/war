import { Rng } from '../core/time';
import { createWorld } from '../ecs/world';
import type { Entity } from '../ecs/components';
import { computeCasualties } from '../ecs/systems/CasualtySystem';
import { createCities, type City } from './cities';
import type { Command } from './commands';
import type { SimEvent } from './events';
import { YIELDS, SALVO_COUNT, type Yield } from '../assets/config';
import { materialAtDir } from './material';
import { angleBetween, type Vec3 } from './geo';
import { flightTimeFor } from './ballistics';

// Время полёта боеголовки до детонации, сек (порт таймингов демо).
const FLIGHT_TIME = 2.6;

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

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.cities = createCities();
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
        this.applySalvo(events);
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

  // Залп МБР (спека 2026-07-14): SALVO_COUNT ракет из случайных точек суши по случайным
  // ЖИВЫМ городам (жертвы и лента работают); городов не осталось — по случайным точкам суши.
  // Мощность — текущая выбранная (setYield). Время полёта — от дальности (ballistics).
  private applySalvo(events: SimEvent[]): void {
    assertValidYield(this.currentYield);
    const alive = this.cities.filter((c) => c.alive > 0);
    for (let i = 0; i < SALVO_COUNT; i++) {
      const from = this.randomLandDir();
      const target =
        alive.length > 0 ? alive[this.rng.int(alive.length)]!.dir : this.randomLandDir();
      const flightTime = flightTimeFor(angleBetween(from, target));
      const id = this.nextId++;
      const entity = this.world.add({
        warhead: {
          yield: this.currentYield,
          seed: this.rng.int(1_000_000_000),
          t: 0,
          flightTime,
          dir: target,
          from,
        },
      });
      this.ids.set(entity, id);
      events.push({
        kind: 'missileLaunched',
        id,
        dir: target,
        yield: this.currentYield,
        flightTime,
        from,
      });
    }
  }

  private applyReset(events: SimEvent[]): void {
    // Убираем боеголовки в полёте и воскрешаем города.
    for (const entity of [...this.world.with('warhead')]) this.world.remove(entity);
    this.cities = createCities();
    this.bombs = 0;
    this.megatons = 0;
    this.totalDeaths = 0;
    events.push({ kind: 'planetReset' });
    events.push({ kind: 'statsChanged', bombs: 0, megatons: 0, deaths: 0 });
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
        events.push({ kind: 'cityHit', name: h.name, deaths: h.deaths, atWaveTime: h.atWaveTime });
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
    }
  }

  // Снимок состояния для отладки/сериализации (не участвует в геймплейной логике).
  snapshot(): unknown {
    return {
      cities: this.cities.map((c) => ({ name: c.name, alive: c.alive })),
      bombs: this.bombs,
      megatons: this.megatons,
      totalDeaths: this.totalDeaths,
      currentYield: this.currentYield,
      labelsEnabled: this.labelsEnabled,
    };
  }
}
