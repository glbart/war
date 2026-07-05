import { Rng } from '../core/time';
import { createWorld } from '../ecs/world';
import type { Entity } from '../ecs/components';
import { computeCasualties } from '../ecs/systems/CasualtySystem';
import { createCities, type City } from './cities';
import type { Command } from './commands';
import type { SimEvent } from './events';
import { YIELDS, type Yield } from '../assets/config';
import { materialAtDir } from './material';

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
  private currentYield = 10;

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
        events.push({ kind: 'missileLaunched', id, dir: cmd.dir, yield: cmd.yield });
        break;
      }
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
