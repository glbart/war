import { describe, it, expect } from 'vitest';
import {
  evalCurve,
  combineScore,
  sCurve,
  threshold,
  RISING,
  FALLING,
  SLOW_THEN_FAST,
  FAST_SATURATE,
} from '../../src/sim/ai/curves';
import { decide } from '../../src/sim/ai/decide';
import { actionSize, allowedByDoctrine, ACTIONS } from '../../src/sim/ai/actions';
import { Rng } from '../../src/core/time';
import { ctx, rival } from '../helpers/ai';
import { AI_STRIKE_COOLDOWN, RETALIATION_PER_DEATHS, SALVO_COUNT } from '../../src/assets/config';

const rng = () => new Rng(42);

describe('Кривые отклика', () => {
  it('края и монотонность базовых форм', () => {
    expect(evalCurve(RISING, 0)).toBe(0);
    expect(evalCurve(RISING, 1)).toBe(1);
    expect(evalCurve(FALLING, 0)).toBe(1);
    expect(evalCurve(FALLING, 1)).toBe(0);
    for (const curve of [RISING, SLOW_THEN_FAST, FAST_SATURATE]) {
      let prev = -1;
      for (let x = 0; x <= 1.0001; x += 0.1) {
        const y = evalCurve(curve, x);
        expect(y).toBeGreaterThanOrEqual(prev);
        prev = y;
      }
    }
  });

  it('медленный старт растёт позже быстрого насыщения', () => {
    expect(evalCurve(SLOW_THEN_FAST, 0.3)).toBeLessThan(evalCurve(FAST_SATURATE, 0.3));
  });

  it('логистическая симметрична в центре и клампится', () => {
    expect(evalCurve(sCurve(0.5), 0.5)).toBeCloseTo(0.5, 6);
    expect(evalCurve(sCurve(0.5), 5)).toBeGreaterThan(0.99); // вход клампится в 0..1
    expect(evalCurve(sCurve(0.5), -5)).toBeLessThan(0.02);
  });

  it('ступень режет по порогу', () => {
    expect(evalCurve(threshold(0.7), 0.69)).toBe(0);
    expect(evalCurve(threshold(0.7), 0.7)).toBe(1);
  });
});

describe('Свёртка оценки', () => {
  it('любое нулевое соображение обнуляет вариант (вето)', () => {
    expect(combineScore([0.9, 0.9, 0])).toBe(0);
  });

  it('компенсация не даёт длинному списку проигрывать короткому при равных множителях', () => {
    const short = combineScore([0.8, 0.8]);
    const long = combineScore([0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
    expect(long).toBeGreaterThan(0.8 ** 6); // сырое произведение было бы 0.26
    expect(long).toBeGreaterThan(short * 0.5);
  });

  it('пустой список и границы', () => {
    expect(combineScore([])).toBe(0);
    expect(combineScore([1, 1, 1])).toBe(1);
  });
});

describe('Решения: таблица ситуаций', () => {
  it('свежая обида при полном арсенале — удар', () => {
    const d = decide(ctx({}, [rival('russia', { grievance: 15, level: 1 })]), rng());
    expect(['demonstrate', 'limited']).toContain(d.action);
    expect(d.target).toBe('russia');
  });

  it('без обиды страна не начинает войну сама', () => {
    const d = decide(ctx({}, [rival('russia', { grievance: 0, level: 0 })]), rng());
    expect(d.action).toBe('wait');
  });

  it('перемирие — вето на удары по этой стороне', () => {
    const d = decide(ctx({}, [rival('russia', { grievance: 40, level: 2, truce: true })]), rng());
    expect(['demonstrate', 'limited', 'massive', 'allOut']).not.toContain(d.action);
  });

  it('только что отстрелявшаяся сторона выжидает перезарядку', () => {
    const hot = ctx({ sinceStrike: 0 }, [rival('russia', { grievance: 30, level: 2 })]);
    expect(decide(hot, rng()).action).toBe('wait');
    const reloaded = ctx({ sinceStrike: AI_STRIKE_COOLDOWN }, [
      rival('russia', { grievance: 30, level: 2 }),
    ]);
    expect(decide(reloaded, rng()).action).not.toBe('wait');
  });

  it('пустой арсенал в разгар войны толкает к переговорам', () => {
    const d = decide(
      ctx({ arsenal: 0, arsenalFrac: 0, damageFrac: 0.4 }, [
        rival('russia', { grievance: 40, level: 2 }),
      ]),
      rng(),
    );
    expect(d.action).toBe('proposePeace');
  });

  it('лежащее предложение при тяжёлых потерях принимается', () => {
    const d = decide(
      ctx({ temperament: 'dove', damageFrac: 0.5, arsenalFrac: 0.2, arsenal: 5 }, [
        rival('russia', { grievance: 10, level: 2, offerFromThem: true, offerPending: true }),
      ]),
      rng(),
    );
    expect(d.action).toBe('acceptPeace');
  });

  it('доктрина «выкл» — сторона не делает ничего', () => {
    const d = decide(
      ctx({}, [rival('russia', { grievance: 50, level: 4 })], { doctrine: 'off', ceiling: 0 }),
      rng(),
    );
    expect(d.action).toBe('wait');
  });

  it('сдержанная доктрина не допускает крупных ударов, эскалация — допускает', () => {
    for (const id of ['massive', 'allOut'] as const) {
      expect(allowedByDoctrine('restrained', id)).toBe(false);
    }
    expect(allowedByDoctrine('escalate', 'massive')).toBe(true);
    expect(allowedByDoctrine('doomsday', 'allOut')).toBe(true);
    expect(allowedByDoctrine('doomsday', 'proposePeace')).toBe(false); // тотальные не мирятся
  });

  it('за союзника вступаются, но никогда против своего блока', () => {
    const d = decide(
      ctx({ temperament: 'hawk' }, [
        rival('russia', { grievance: 0, level: 0, allyHeat: 3 }),
        rival('europe', { grievance: 0, level: 0, ally: true, allyHeat: 3 }),
      ]),
      rng(),
    );
    expect(d.action).toBe('joinAlly');
    expect(d.target).toBe('russia');
  });

  it('решение объясняется: возвращается разложение лучших вариантов', () => {
    const d = decide(ctx({}, [rival('russia', { grievance: 15, level: 1 })]), rng());
    expect(d.top.length).toBeGreaterThan(0);
    expect(d.top[0]!.considerations.length).toBeGreaterThan(1);
    for (const c of d.top[0]!.considerations) {
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.value).toBeLessThanOrEqual(1);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('разложение всегда объясняет ВЫБРАННОЕ действие, а не просто лучшее по оценке', () => {
    const cases = [
      ctx({}, [rival('russia', { grievance: 15, level: 1 })]),
      ctx({ sinceStrike: 0 }, [rival('russia', { grievance: 30, level: 2 })]),
      ctx({ arsenal: 0, arsenalFrac: 0 }, [rival('russia', { grievance: 30, level: 2 })]),
    ];
    for (const c of cases) {
      const d = decide(c, rng());
      expect(d.top[0]!.action).toBe(d.action);
      expect(d.top[0]!.target).toBe(d.target);
      expect(d.top[0]!.score).toBeCloseTo(d.score, 6);
    }
  });

  it('детерминизм: один seed — одно решение', () => {
    const c = ctx({}, [rival('russia', { grievance: 15, level: 2 })]);
    expect(decide(c, rng())).toEqual(decide(c, rng()));
  });
});

describe('Размер волны по действию', () => {
  const c = ctx({ arsenal: 30 }, [rival('russia', { grievance: RETALIATION_PER_DEATHS * 3 })]);
  const r = c.rivals[0]!;

  it('демонстрация — одна ракета, соразмерный — по обиде, полномасштабный — вдвое', () => {
    expect(actionSize('demonstrate', c, r)).toBe(1);
    expect(actionSize('limited', c, r)).toBe(3);
    expect(actionSize('massive', c, r)).toBe(6);
    expect(actionSize('joinAlly', c, r)).toBe(2);
  });

  it('соразмерный ответ не превышает залпа, всё сразу ограничено арсеналом', () => {
    const huge = ctx({ arsenal: 4 }, [rival('russia', { grievance: 1000 })]);
    expect(actionSize('limited', huge, huge.rivals[0]!)).toBeLessThanOrEqual(SALVO_COUNT);
    expect(actionSize('allOut', huge, huge.rivals[0]!)).toBe(4);
    expect(actionSize('wait', huge, huge.rivals[0]!)).toBe(0);
  });
});

describe('Набор действий', () => {
  it('у каждого шаблона есть веса под все нравы', () => {
    for (const a of ACTIONS) {
      for (const t of ['dove', 'balanced', 'hawk'] as const) {
        expect(a.weight[t]).toBeGreaterThan(0);
      }
    }
  });
});
