import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { materialAtDir } from '../../src/sim/material';
import { SALVO_COUNT, BALLISTIC_TIME_MIN } from '../../src/assets/config';
import { TICK_DT } from '../../src/core/time';

describe('Simulation: залп МБР', () => {
  it('salvo порождает SALVO_COUNT пусков со стартами на суше и баллистическими таймингами', () => {
    const sim = new Simulation(123);
    const events = sim.step(TICK_DT, [{ kind: 'salvo' }]);
    const launches = events.filter((e) => e.kind === 'missileLaunched');
    expect(launches).toHaveLength(SALVO_COUNT);
    for (const l of launches) {
      if (l.kind !== 'missileLaunched') continue;
      expect(l.from).toBeDefined();
      expect(materialAtDir(l.from!).surface).not.toBe('water'); // старт с суши
      expect(l.flightTime).toBeGreaterThanOrEqual(BALLISTIC_TIME_MIN);
    }
  });

  it('детерминизм: одинаковый seed → одинаковый залп', () => {
    const a = new Simulation(42).step(TICK_DT, [{ kind: 'salvo' }]);
    const b = new Simulation(42).step(TICK_DT, [{ kind: 'salvo' }]);
    expect(a).toEqual(b);
  });

  it('взрывы приходят по индивидуальным flightTime (после максимального — все взорвались)', () => {
    const sim = new Simulation(7);
    const launches = sim.step(TICK_DT, [{ kind: 'salvo' }]);
    const maxT = Math.max(
      ...launches.flatMap((e) => (e.kind === 'missileLaunched' ? [e.flightTime] : [])),
    );
    let explosions = 0;
    const steps = Math.ceil((maxT + 1) / TICK_DT);
    for (let i = 0; i < steps; i++) {
      for (const e of sim.step(TICK_DT, [])) if (e.kind === 'explosionStarted') explosions++;
    }
    expect(explosions).toBe(SALVO_COUNT);
  });

  it('ручной detonate остаётся ударом из космоса: без from, прежний тайминг', () => {
    const sim = new Simulation(1);
    const events = sim.step(TICK_DT, [{ kind: 'detonate', dir: { x: 0, y: 0, z: 1 }, yield: 10 }]);
    const l = events.find((e) => e.kind === 'missileLaunched');
    expect(l && l.kind === 'missileLaunched' ? l.from : 'нет события').toBeUndefined();
    expect(l && l.kind === 'missileLaunched' ? l.flightTime : 0).toBeCloseTo(2.6, 6);
  });
});
