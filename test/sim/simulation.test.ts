import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { lonLatToDir } from '../../src/sim/geo';
import { TICK_DT } from '../../src/core/time';

describe('Simulation', () => {
  it('detonate рождает missileLaunched, затем explosionStarted после полёта', () => {
    const sim = new Simulation(123);
    const dir = lonLatToDir((37.62 * Math.PI) / 180, (55.75 * Math.PI) / 180);
    let ev = sim.step(TICK_DT, [{ kind: 'detonate', dir, yield: 10 }]);
    expect(ev.some((e) => e.kind === 'missileLaunched')).toBe(true);
    // прогоняем ~3 секунды (полёт 2.6с)
    let exploded = false;
    for (let i = 0; i < 100; i++) {
      ev = sim.step(TICK_DT, []);
      if (ev.some((e) => e.kind === 'explosionStarted')) exploded = true;
    }
    expect(exploded).toBe(true);
  });
  it('детерминизм: одинаковый seed и команды -> одинаковые события', () => {
    const run = () => {
      const sim = new Simulation(7);
      const dir = lonLatToDir(0.5, 0.5);
      const out: string[] = [];
      let cmds = [{ kind: 'detonate', dir, yield: 100 } as const];
      for (let i = 0; i < 120; i++) {
        for (const e of sim.step(TICK_DT, cmds))
          out.push(e.kind + (e.kind === 'cityHit' ? ':' + e.name : ''));
        cmds = [];
      }
      return out.join('|');
    };
    expect(run()).toEqual(run());
  });
  it('detonate с недопустимой мощностью бросает ошибку и не создаёт боеголовку', () => {
    const sim = new Simulation(1);
    const dir = lonLatToDir(0.1, 0.1);
    expect(() => sim.step(TICK_DT, [{ kind: 'detonate', dir, yield: 5 }])).toThrow(
      /Недопустимая мощность заряда/,
    );
    // боеголовка не создана: последующие тики не порождают explosionStarted.
    let exploded = false;
    for (let i = 0; i < 100; i++) {
      const ev = sim.step(TICK_DT, []);
      if (ev.some((e) => e.kind === 'explosionStarted')) exploded = true;
    }
    expect(exploded).toBe(false);
  });
  it('setYield с недопустимой мощностью бросает ошибку', () => {
    const sim = new Simulation(1);
    expect(() => sim.step(TICK_DT, [{ kind: 'setYield', yield: 7 }])).toThrow(
      /Недопустимая мощность заряда/,
    );
  });
  it('detonate/setYield с валидными мощностями (1/10/100) по-прежнему работают', () => {
    const sim = new Simulation(2);
    const dir = lonLatToDir(0.2, 0.2);
    for (const yieldMt of [1, 10, 100] as const) {
      expect(() => sim.step(TICK_DT, [{ kind: 'setYield', yield: yieldMt }])).not.toThrow();
      expect(() => sim.step(TICK_DT, [{ kind: 'detonate', dir, yield: yieldMt }])).not.toThrow();
    }
    let exploded = 0;
    for (let i = 0; i < 100; i++) {
      const ev = sim.step(TICK_DT, []);
      exploded += ev.filter((e) => e.kind === 'explosionStarted').length;
    }
    expect(exploded).toBe(3);
  });
  it('детонация над океаном даёт surface=water в explosionStarted', () => {
    const sim = new Simulation(1);
    const dir = lonLatToDir(-140 * (Math.PI / 180), 0); // центр Тихого
    sim.step(0, [{ kind: 'detonate', dir, yield: 10 }]);
    const events = sim.step(3, []); // за FLIGHT_TIME=2.6 боеголовка долетает
    const boom = events.find((e) => e.kind === 'explosionStarted');
    expect(boom).toBeDefined();
    expect(boom && 'surface' in boom && boom.surface).toBe('water');
  });
});
