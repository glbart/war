import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { lonLatToDir } from '../../src/sim/geo';
import { factionById } from '../../src/sim/factions';
import { alliesOf } from '../../src/sim/diplomacy';
import { TICK_DT } from '../../src/core/time';
import type { SimEvent } from '../../src/sim/events';
import { run, of, statOf, strikeThatLands } from '../helpers/war';

const at = (lonDeg: number, latDeg: number) =>
  lonLatToDir((lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180);

const MOSCOW = at(37.62, 55.75);
const NEW_YORK = at(-74.01, 40.71);
const TOKYO = at(139.76, 35.68);
const PYONGYANG = at(125.75, 39.03);

const revenges = (events: SimEvent[]) => of(events, 'retaliationLaunched');

describe('Ответный удар', () => {
  it('удар США по Москве → Россия отвечает по США и тратит арсенал', () => {
    const { events } = strikeThatLands(12, [
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    const answer = revenges(events).find((r) => r.from === 'russia');
    expect(answer).toBeDefined();
    expect(answer!.to).toBe('usa');
    expect(answer!.reason).toBe('revenge');
    expect(answer!.count).toBeGreaterThan(0);
    expect(statOf(events, 'russia')!.arsenal).toBe(factionById('russia').arsenal - answer!.count);
  });

  it('стороны становятся воюющими — это видно в статистике сторон', () => {
    // сид ищем: ПРО России может сбить одиночную боеголовку, тогда войны не будет
    const { events } = strikeThatLands(6, [
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    expect(statOf(events, 'russia')!.enemies.map((e) => e.id)).toContain('usa');
    expect(statOf(events, 'usa')!.enemies.map((e) => e.id)).toContain('russia');
  });

  it('доктрина «выкл» — ответов нет вообще', () => {
    const sim = new Simulation(103);
    const events = run(sim, 20, [
      { kind: 'setDoctrine', doctrine: 'off' },
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    expect(revenges(events)).toHaveLength(0);
    expect(events.some((e) => e.kind === 'doctrineChanged')).toBe(true);
  });

  it('союзник жертвы вступается позже и меньшим залпом', () => {
    const sim = new Simulation(104);
    const events = run(sim, 20, [{ kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' }]);
    const own = revenges(events).find((r) => r.from === 'russia' && r.reason === 'revenge');
    const ally = revenges(events).find((r) => r.reason === 'ally');
    expect(ally).toBeDefined();
    expect(alliesOf('russia')).toContain(ally!.from);
    expect(ally!.to).toBe('usa');
    expect(ally!.count).toBeLessThanOrEqual(own!.count);
  });

  it('залп по стране даёт ОДИН ответ жертвы, а не по ответу на каждую ракету', () => {
    const { events } = strikeThatLands(14, [{ kind: 'salvo', from: 'usa', to: 'russia' }]);
    const own = revenges(events).filter((r) => r.from === 'russia' && r.reason === 'revenge');
    expect(own).toHaveLength(1);
  });

  it('анонимный удар: жертва винит другую сторону, но не себя', () => {
    const { events } = strikeThatLands(12, [{ kind: 'detonate', dir: MOSCOW, yield: 100 }]);
    const answer = revenges(events).find((r) => r.from === 'russia');
    expect(answer).toBeDefined();
    expect(answer!.to).not.toBe('russia');
  });

  it('удар по нейтральному городу никого не поднимает', () => {
    const sim = new Simulation(107);
    const events = run(sim, 20, [{ kind: 'detonate', dir: TOKYO, yield: 100, faction: 'usa' }]);
    expect(revenges(events)).toHaveLength(0);
  });

  it('сторона без арсенала не отвечает (КНДР расстреляла запас)', () => {
    const sim = new Simulation(108);
    // КНДР тратит все боеголовки, ждём прилёта её ракет, затем бьём по Пхеньяну.
    run(sim, 12, [{ kind: 'salvo', from: 'dprk', to: 'india' }]);
    const events = run(sim, 20, [{ kind: 'detonate', dir: PYONGYANG, yield: 100, faction: 'usa' }]);
    expect(statOf(events, 'dprk')!.arsenal).toBe(0);
    expect(revenges(events).filter((r) => r.from === 'dprk')).toHaveLength(0);
  });

  it('reset отменяет запланированный ответ и снимает войны', () => {
    const sim = new Simulation(109);
    run(sim, 3, [{ kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' }]);
    const afterReset = run(sim, 20, [{ kind: 'reset' }]);
    expect(revenges(afterReset)).toHaveLength(0);
    expect(statOf(afterReset, 'russia')!.enemies).toEqual([]);
    expect(statOf(afterReset, 'russia')!.arsenal).toBe(factionById('russia').arsenal);
  });

  it('обмен раскручивается: удар порождает цепочку ответов с обеих сторон', () => {
    const { sim, events: first } = strikeThatLands(12, [
      { kind: 'detonate', dir: NEW_YORK, yield: 100, faction: 'russia' },
    ]);
    const events = [...first, ...run(sim, 40)];
    const sides = new Set(revenges(events).map((r) => r.from));
    expect(sides.size).toBeGreaterThan(1); // отвечает не только первая жертва
    expect(revenges(events).length).toBeGreaterThan(1);
  });

  it('за союзника не воюют против своего же блока (задел свой — отвечает только жертва)', () => {
    const sim = new Simulation(114);
    // США бьют по Парижу: Европа — их союзник, значит блок не должен разлететься на части.
    const events = run(sim, 30, [
      { kind: 'detonate', dir: at(2.35, 48.86), yield: 100, faction: 'usa' },
    ]);
    const allyWaves = revenges(events).filter((r) => r.reason === 'ally');
    for (const r of allyWaves) expect(alliesOf(r.from)).not.toContain(r.to);
    // сама пострадавшая сторона ответить вправе — даже союзнику
    expect(revenges(events).some((r) => r.from === 'europe' && r.to === 'usa')).toBe(true);
  });

  it('ни один ответ «за союзника» не направлен в собственный блок', () => {
    for (const seed of [201, 202, 203]) {
      const events = run(new Simulation(seed), 45, [{ kind: 'salvo', from: 'usa', to: 'russia' }]);
      for (const r of revenges(events).filter((x) => x.reason === 'ally')) {
        expect(alliesOf(r.from)).not.toContain(r.to);
      }
    }
  });

  it('эскалация поднимает потолок конфликта выше сдержанной доктрины', () => {
    const level = (doctrine: 'restrained' | 'escalate') => {
      const { sim, events: first } = strikeThatLands(14, [
        { kind: 'setDoctrine', doctrine },
        { kind: 'salvo', from: 'usa', to: 'russia' },
      ]);
      const events = [...first, ...run(sim, 30, [{ kind: 'salvo', from: 'usa', to: 'russia' }])];
      return statOf(events, 'russia')!.enemies.find((e) => e.id === 'usa')?.level ?? 0;
    };
    expect(level('escalate')).toBeGreaterThan(level('restrained'));
  });

  it('неизвестная доктрина — ошибка на границе применения команд', () => {
    const sim = new Simulation(112);
    expect(() =>
      sim.step(TICK_DT, [{ kind: 'setDoctrine', doctrine: 'первый удар' as 'off' }]),
    ).toThrow(/Неизвестная доктрина/);
  });

  it('детерминизм: одинаковый seed → одинаковая цепочка ответов', () => {
    const go = () =>
      JSON.stringify(
        run(new Simulation(113), 30, [
          { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
        ]).filter((e) => e.kind === 'retaliationLaunched'),
      );
    expect(go()).toEqual(go());
  });
});
