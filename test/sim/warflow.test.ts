import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { lonLatToDir } from '../../src/sim/geo';
import { DEFENSES } from '../../src/sim/defense';
import { TICK_DT } from '../../src/core/time';
import { PEACE_OFFER_TIMEOUT } from '../../src/assets/config';
import type { Command } from '../../src/sim/commands';
import type { SimEvent } from '../../src/sim/events';
import { run, of, statOf, strikeThatLands } from '../helpers/war';

const at = (lonDeg: number, latDeg: number) =>
  lonLatToDir((lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180);
const MOSCOW = at(37.62, 55.75);

describe('ПРО в бою', () => {
  it('ПРО жертвы отрабатывает по подлетающей боеголовке и тратит перехватчик', () => {
    // Ищем сид, где ПРО России успела отработать по удару США (промах тоже считается).
    let seen: SimEvent[] | undefined;
    for (let seed = 1; seed <= 20 && seen === undefined; seed++) {
      const events = run(new Simulation(seed), 6, [
        { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
      ]);
      if (of(events, 'interception').some((e) => e.by === 'russia')) seen = events;
    }
    expect(seen).toBeDefined();
    const shot = of(seen!, 'interception').find((e) => e.by === 'russia')!;
    expect(statOf(seen!, 'russia')!.interceptors).toBe(DEFENSES.russia.interceptors - 1);
    // успешный перехват отменяет взрыв этой боеголовки
    if (shot.success) {
      expect(of(seen!, 'explosionStarted').some((e) => e.id === shot.id)).toBe(false);
    }
  });

  it('свои ракеты сторона не сбивает', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const events = run(new Simulation(seed), 8, [
        { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'russia' },
      ]);
      expect(of(events, 'interception').some((e) => e.by === 'russia')).toBe(false);
    }
  });

  it('удар в океан не перехватывает никто (ПРО прикрывает только территорию)', () => {
    const events = run(new Simulation(5), 8, [
      { kind: 'detonate', dir: at(-140, 0), yield: 100, faction: 'usa' },
    ]);
    expect(of(events, 'interception')).toHaveLength(0);
  });
});

describe('Лестница эскалации', () => {
  it('первый удар — кризис: ответ остаётся сдержанным, а не полномасштабным', () => {
    const { events } = strikeThatLands(14, [
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    const answer = of(events, 'retaliationLaunched').find((r) => r.from === 'russia');
    expect(answer).toBeDefined();
    // на кризисе сторона выбирает предупреждение или соразмерный ответ, но не тотальный
    expect(['demonstrate', 'limited']).toContain(answer!.action);
    expect(answer!.count).toBeLessThanOrEqual(2);
    expect(
      statOf(events, 'russia')!.enemies.find((e) => e.id === 'usa')!.level,
    ).toBeLessThanOrEqual(2);
  });

  it('повторные удары поднимают уровень пары и не мельчат ответ', () => {
    const { sim, events: first } = strikeThatLands(14, [
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    const second = run(sim, 20, [{ kind: 'salvo', from: 'usa', to: 'russia' }]);
    const maxFrom = (events: SimEvent[]) =>
      Math.max(
        0,
        ...of(events, 'retaliationLaunched')
          .filter((r) => r.from === 'russia')
          .map((r) => r.count),
      );
    expect(maxFrom(first)).toBe(1); // кризис — только демонстрация
    expect(maxFrom(second)).toBeGreaterThanOrEqual(maxFrom(first));
    expect(statOf(second, 'russia')!.enemies.find((e) => e.id === 'usa')!.level).toBe(2);
  });

  it('сдержанная доктрина держит потолок уровня', () => {
    const sim = new Simulation(33);
    let events: SimEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events = run(sim, 12, [{ kind: 'salvo', from: 'usa', to: 'russia' }]);
    }
    const level = statOf(events, 'russia')!.enemies.find((e) => e.id === 'usa')?.level ?? 0;
    expect(level).toBeLessThanOrEqual(2); // потолок доктрины restrained
  });
});

describe('Переговоры и перемирие', () => {
  // Игрок за США начинает войну залпом — дальше стороны сами ищут выход.
  const seedCmds: Command[] = [
    { kind: 'setSide', faction: 'usa' },
    { kind: 'salvo', from: 'usa', to: 'russia' },
  ];

  it('предложение игрока обдумывается стороной и может быть принято', () => {
    let accepted: SimEvent[] | undefined;
    for (let seed = 1; seed <= 40 && accepted === undefined; seed++) {
      const sim = new Simulation(seed);
      run(sim, 20, [
        { kind: 'setSide', faction: 'usa' },
        { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
      ]);
      // ИИ отвечает не мгновенно, а на своём пульсе раздумий — даём ему время
      const events = run(sim, 12, [{ kind: 'proposeCeasefire', from: 'usa', to: 'russia' }]);
      if (of(events, 'ceasefireAccepted').length > 0) accepted = events;
    }
    expect(accepted).toBeDefined();
    const truce = statOf(accepted!, 'russia')!.enemies.find((e) => e.id === 'usa');
    expect(truce?.truce).toBe(true);
    expect(truce?.level).toBe(0);
  });

  it('перемирие держит стороны: пока оно в силе, ударов по партнёру нет', () => {
    let checked = false;
    for (let seed = 1; seed <= 40 && !checked; seed++) {
      const sim = new Simulation(seed);
      run(sim, 20, [
        { kind: 'setSide', faction: 'usa' },
        { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
      ]);
      const answer = run(sim, 12, [{ kind: 'proposeCeasefire', from: 'usa', to: 'russia' }]);
      if (of(answer, 'ceasefireAccepted').length === 0) continue;
      const after = run(sim, 25);
      // пока перемирие не сорвано прилётом, пара не обменивается ударами
      const broken = of(after, 'truceBroken').some(
        (t) =>
          (t.by === 'usa' && t.against === 'russia') || (t.by === 'russia' && t.against === 'usa'),
      );
      const strikes = of(after, 'retaliationLaunched').filter(
        (r) => (r.from === 'russia' && r.to === 'usa') || (r.from === 'usa' && r.to === 'russia'),
      );
      if (!broken) expect(strikes).toHaveLength(0);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('предложение стороне игрока ждёт его ответа: молчание — отказ, согласие — перемирие', () => {
    let seen = false;
    for (let seed = 1; seed <= 60 && !seen; seed++) {
      const sim = new Simulation(seed);
      let offer: Extract<SimEvent, { kind: 'ceasefireProposed' }> | undefined;
      let decidedSameTick = false;
      const steps = Math.ceil(90 / TICK_DT);
      for (let i = 0; i < steps && offer === undefined; i++) {
        const ev = sim.step(TICK_DT, i === 0 ? seedCmds : []);
        const p = of(ev, 'ceasefireProposed').find((x) => x.forPlayer);
        if (p === undefined) continue;
        offer = p;
        decidedSameTick = ev.some(
          (e) =>
            (e.kind === 'ceasefireAccepted' || e.kind === 'ceasefireRejected') &&
            e.from === p.from &&
            e.to === p.to,
        );
      }
      if (offer === undefined) continue;
      seen = true;

      // за игрока никто не решает
      expect(decidedSameTick).toBe(false);
      // молчание дольше таймера = отказ
      const later = run(sim, PEACE_OFFER_TIMEOUT + 1);
      expect(
        of(later, 'ceasefireRejected').some((r) => r.from === offer!.from && r.to === offer!.to),
      ).toBe(true);

      // а явное согласие даёт перемирие
      const sim2 = new Simulation(seed);
      let accepted = false;
      for (let i = 0; i < steps && !accepted; i++) {
        const ev = sim2.step(TICK_DT, i === 0 ? seedCmds : []);
        const p = of(ev, 'ceasefireProposed').find((x) => x.forPlayer);
        if (p === undefined) continue;
        const answer = sim2.step(TICK_DT, [
          { kind: 'ceasefireResponse', from: p.from, to: p.to, accept: true },
        ]);
        expect(of(answer, 'ceasefireAccepted')).toHaveLength(1);
        accepted = true;
      }
      expect(accepted).toBe(true);
    }
    expect(seen).toBe(true);
  });

  it('при доктрине «всё сразу» переговоров не бывает', () => {
    const sim = new Simulation(37);
    const events = run(sim, 60, [
      { kind: 'setDoctrine', doctrine: 'doomsday' },
      { kind: 'salvo', from: 'usa', to: 'russia' },
    ]);
    expect(of(events, 'ceasefireProposed')).toHaveLength(0);
  });
});

describe('Условия победы в партии', () => {
  it('тотальный обмен доводит партию до исхода, и объявляется он один раз', () => {
    const sim = new Simulation(41);
    const events = run(sim, 400, [
      { kind: 'setDoctrine', doctrine: 'doomsday' },
      { kind: 'salvo', from: 'usa', to: 'russia' },
    ]);
    const over = of(events, 'gameOver');
    expect(over).toHaveLength(1);
    expect(['victory', 'mutual', 'exhausted', 'peace', 'pyrrhic']).toContain(over[0]!.outcome);
    const summary = over[0]!.summary;
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.reduce((s, r) => s + r.launched, 0)).toBeGreaterThan(0);
  });

  it('локальный обмен со сдержанной доктриной затухает и партия получает исход', () => {
    const { sim, events: first } = strikeThatLands(20, [
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    const events = [...first, ...run(sim, 900)];
    const over = of(events, 'gameOver');
    expect(over).toHaveLength(1);
    expect(['victory', 'mutual', 'exhausted', 'peace', 'pyrrhic']).toContain(over[0]!.outcome);
  });

  it('reset начинает партию заново: исход может прийти снова', () => {
    const { sim } = strikeThatLands(20, [
      { kind: 'detonate', dir: MOSCOW, yield: 100, faction: 'usa' },
    ]);
    run(sim, 900);
    const again = run(sim, 900, [{ kind: 'reset' }, { kind: 'salvo', from: 'usa', to: 'russia' }]);
    expect(of(again, 'gameOver')).toHaveLength(1);
  });

  it('детерминизм: одинаковый seed → одинаковая партия', () => {
    const go = () =>
      JSON.stringify(
        run(new Simulation(44), 120, [
          { kind: 'setDoctrine', doctrine: 'escalate' },
          { kind: 'salvo', from: 'usa', to: 'russia' },
        ]).map((e) => e.kind),
      );
    expect(go()).toEqual(go());
  });
});
