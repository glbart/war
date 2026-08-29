import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { materialAtDir } from '../../src/sim/material';
import { createCities } from '../../src/sim/cities';
import { factionById, type FactionId } from '../../src/sim/factions';
import { angleBetween, lonLatToDir, type Vec3 } from '../../src/sim/geo';
import { SALVO_COUNT, BALLISTIC_TIME_MIN, FACTION_LAUNCH_JITTER } from '../../src/assets/config';
import { TICK_DT } from '../../src/core/time';
import type { SimEvent, FactionStat } from '../../src/sim/events';
import { strikeThatLands } from '../helpers/war';

const launches = (events: SimEvent[]) =>
  events.flatMap((e) => (e.kind === 'missileLaunched' ? [e] : []));

const stats = (events: SimEvent[]): FactionStat[] => {
  const e = events.filter((x) => x.kind === 'factionsChanged').at(-1);
  return e && e.kind === 'factionsChanged' ? e.factions : [];
};

const statOf = (events: SimEvent[], id: FactionId) => stats(events).find((s) => s.id === id)!;

// Ближайший город стороны к точке (для проверки, что старт — с территории агрессора).
const nearestCityOf = (id: FactionId, dir: Vec3) =>
  createCities()
    .filter((c) => c.faction === id)
    .reduce((best, c) => (angleBetween(c.dir, dir) < angleBetween(best.dir, dir) ? c : best));

describe('Simulation: залп МБР по сторонам', () => {
  it('залп «страна → страна»: старты у городов агрессора (на суше), цели — города жертвы', () => {
    const sim = new Simulation(123);
    const events = sim.step(TICK_DT, [{ kind: 'salvo', from: 'usa', to: 'russia' }]);
    const ls = launches(events);
    expect(ls).toHaveLength(SALVO_COUNT);

    const russianCities = createCities().filter((c) => c.faction === 'russia');
    for (const l of ls) {
      expect(l.faction).toBe('usa');
      expect(l.from).toBeDefined();
      expect(materialAtDir(l.from!).surface).not.toBe('water'); // старт с суши
      expect(l.flightTime).toBeGreaterThanOrEqual(BALLISTIC_TIME_MIN);
      // цель — ровно один из городов России
      expect(russianCities.some((c) => angleBetween(c.dir, l.dir) < 1e-9)).toBe(true);
    }
  });

  it('пусковые площадки — рядом с городами агрессора, а не в его центре', () => {
    const sim = new Simulation(5);
    const ls = launches(sim.step(TICK_DT, [{ kind: 'salvo', from: 'russia', to: 'usa' }]));
    for (const l of ls) {
      const near = nearestCityOf('russia', l.from!);
      const d = angleBetween(near.dir, l.from!);
      // либо разброс вокруг города (в пределах джиттера), либо редкий фолбэк «случайная суша»
      if (d <= FACTION_LAUNCH_JITTER + 1e-9) expect(d).toBeGreaterThan(0);
    }
  });

  it('залп тратит арсенал: размер залпа ограничен остатком, при нуле пусков нет', () => {
    const sim = new Simulation(9);
    const start = factionById('dprk').arsenal; // самая маленькая сторона — 3 боеголовки
    expect(start).toBeLessThan(SALVO_COUNT);

    const first = sim.step(TICK_DT, [{ kind: 'salvo', from: 'dprk', to: 'usa' }]);
    expect(launches(first)).toHaveLength(start);
    expect(statOf(first, 'dprk').arsenal).toBe(0);

    const second = sim.step(TICK_DT, [{ kind: 'salvo', from: 'dprk', to: 'usa' }]);
    expect(launches(second)).toHaveLength(0);
  });

  it('сторона без живых городов не пускает даже с полным арсеналом (обезглавлена)', () => {
    const sim = new Simulation(11);
    // КНДР — один город: сносим Пхеньян прямым ударом и ждём прилёта.
    sim.step(TICK_DT, [
      {
        kind: 'detonate',
        dir: lonLatToDir((125.75 * Math.PI) / 180, (39.03 * Math.PI) / 180),
        yield: 100,
      },
    ]);
    let after: SimEvent[] = [];
    for (let i = 0; i < 120; i++) after = after.concat(sim.step(TICK_DT, []));
    expect(statOf(after, 'dprk').citiesAlive).toBe(0);
    expect(statOf(after, 'dprk').arsenal).toBe(factionById('dprk').arsenal); // арсенал цел
    expect(launches(sim.step(TICK_DT, [{ kind: 'salvo', from: 'dprk' }]))).toHaveLength(0);
  });

  it('без указания сторон симуляция выбирает агрессора и жертву сама', () => {
    const sim = new Simulation(77);
    const ls = launches(sim.step(TICK_DT, [{ kind: 'salvo' }]));
    expect(ls.length).toBeGreaterThan(0);
    const attacker = ls[0]!.faction;
    expect(attacker).toBeDefined();
    expect(attacker).not.toBe('neutral');
    for (const l of ls) expect(l.faction).toBe(attacker); // залп — одной стороны
  });

  it('удар по городу стороны уменьшает её население в factionsChanged', () => {
    // ПРО может сбить одиночную боеголовку — берём сид, на котором удар дошёл.
    const moscow = lonLatToDir((37.62 * Math.PI) / 180, (55.75 * Math.PI) / 180);
    const { events } = strikeThatLands(6, [{ kind: 'detonate', dir: moscow, yield: 100 }]);
    const hit = events.find((e) => e.kind === 'cityHit' && e.name === 'Moscow');
    expect(hit && hit.kind === 'cityHit' ? hit.faction : undefined).toBe('russia');
    const before = createCities()
      .filter((c) => c.faction === 'russia')
      .reduce((s, c) => s + c.pop, 0);
    expect(statOf(events, 'russia').popAlive).toBeLessThan(before);
  });

  it('reset восстанавливает арсеналы и население сторон', () => {
    const sim = new Simulation(13);
    sim.step(TICK_DT, [{ kind: 'salvo', from: 'usa', to: 'russia' }]);
    const after = sim.step(TICK_DT, [{ kind: 'reset' }]);
    for (const s of stats(after)) {
      expect(s.arsenal).toBe(factionById(s.id).arsenal);
    }
    const usa = statOf(after, 'usa');
    expect(usa.citiesAlive).toBeGreaterThan(0);
  });

  it('неизвестная сторона в команде — ошибка на границе применения', () => {
    const sim = new Simulation(1);
    expect(() => sim.step(TICK_DT, [{ kind: 'salvo', from: 'atlantis' as FactionId }])).toThrow(
      /Неизвестная сторона/,
    );
  });

  it('детерминизм: одинаковый seed → одинаковый залп', () => {
    const a = new Simulation(42).step(TICK_DT, [{ kind: 'salvo' }]);
    const b = new Simulation(42).step(TICK_DT, [{ kind: 'salvo' }]);
    expect(a).toEqual(b);
  });

  it('судьба каждой ракеты залпа решается к концу её полёта: взрыв или перехват', () => {
    const sim = new Simulation(7);
    const ls = launches(sim.step(TICK_DT, [{ kind: 'salvo', from: 'china', to: 'india' }]));
    const ids = new Set(ls.map((e) => e.id));
    const maxT = Math.max(...ls.map((e) => e.flightTime));
    const resolved = new Set<number>();
    const steps = Math.ceil((maxT + 1) / TICK_DT);
    for (let i = 0; i < steps; i++) {
      for (const e of sim.step(TICK_DT, [])) {
        if (e.kind === 'explosionStarted' && ids.has(e.id)) resolved.add(e.id);
        if (e.kind === 'interception' && e.success && ids.has(e.id)) resolved.add(e.id);
      }
    }
    expect(resolved.size).toBe(ids.size);
  });

  it('ручной detonate остаётся ударом из космоса: без from/фракции, прежний тайминг', () => {
    const sim = new Simulation(1);
    const events = sim.step(TICK_DT, [{ kind: 'detonate', dir: { x: 0, y: 0, z: 1 }, yield: 10 }]);
    const l = launches(events)[0]!;
    expect(l.from).toBeUndefined();
    expect(l.faction).toBeUndefined();
    expect(l.flightTime).toBeCloseTo(2.6, 6);
  });
});
