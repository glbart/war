import { describe, it, expect } from 'vitest';
import { evaluateOutcome, isFallen, canFight, OUTCOME_TITLES } from '../../src/sim/victory';
import type { SideSnapshot, GameState } from '../../src/sim/victory';
import { FALLEN_FRAC, PEACE_HOLD_T } from '../../src/assets/config';

const side = (over: Partial<SideSnapshot> & { id: SideSnapshot['id'] }): SideSnapshot => ({
  popAlive: 100,
  popTotal: 100,
  arsenal: 10,
  citiesAlive: 5,
  ...over,
});

const state = (over: Partial<GameState> = {}): GameState => ({
  warHappened: true,
  missilesInFlight: 0,
  atPeace: false,
  quietFor: 0,
  peaceHoldT: PEACE_HOLD_T,
  ...over,
});

describe('Условия победы', () => {
  it('без войны исхода нет, как бы ни выглядели стороны', () => {
    const sides = [side({ id: 'usa' }), side({ id: 'russia', popAlive: 0 })];
    expect(evaluateOutcome(sides, state({ warHappened: false }))).toBeUndefined();
  });

  it('единственная уцелевшая сторона — победа', () => {
    const sides = [side({ id: 'usa' }), side({ id: 'russia', popAlive: 0.2 })];
    expect(evaluateOutcome(sides, state())).toEqual({ outcome: 'victory', winner: 'usa' });
  });

  it('пали все — взаимное уничтожение', () => {
    const sides = [side({ id: 'usa', popAlive: 0 }), side({ id: 'russia', popAlive: 0.1 })];
    expect(evaluateOutcome(sides, state())).toEqual({ outcome: 'mutual' });
  });

  it('никто не может пускать — арсеналы исчерпаны', () => {
    const sides = [side({ id: 'usa', arsenal: 0 }), side({ id: 'russia', citiesAlive: 0 })];
    expect(evaluateOutcome(sides, state())).toEqual({ outcome: 'exhausted' });
  });

  it('тишина при нулевом накале — мир восстановлен, но только выдержав срок', () => {
    const sides = [side({ id: 'usa' }), side({ id: 'russia' })];
    const quiet = state({ atPeace: true, quietFor: PEACE_HOLD_T });
    expect(evaluateOutcome(sides, quiet)).toEqual({ outcome: 'peace' });
    expect(evaluateOutcome(sides, { ...quiet, quietFor: PEACE_HOLD_T - 1 })).toBeUndefined();
  });

  it('пока ракеты в воздухе, партия не заканчивается миром или исчерпанием', () => {
    const sides = [side({ id: 'usa', arsenal: 0 }), side({ id: 'russia', arsenal: 0 })];
    const flying = state({ missilesInFlight: 2, atPeace: true, quietFor: 999 });
    expect(evaluateOutcome(sides, flying)).toBeUndefined();
  });

  it('обычная перестрелка исхода не даёт', () => {
    const sides = [side({ id: 'usa', popAlive: 60 }), side({ id: 'russia', popAlive: 40 })];
    expect(evaluateOutcome(sides, state())).toBeUndefined();
  });

  it('падение и боеспособность считаются по порогам', () => {
    expect(isFallen(side({ id: 'usa', popAlive: FALLEN_FRAC * 100 - 0.001 }))).toBe(true);
    expect(isFallen(side({ id: 'usa', popAlive: 50 }))).toBe(false);
    expect(canFight(side({ id: 'usa', arsenal: 0 }))).toBe(false);
    expect(canFight(side({ id: 'usa', citiesAlive: 0 }))).toBe(false);
    expect(canFight(side({ id: 'usa' }))).toBe(true);
  });

  it('у каждого исхода есть заголовок для экрана итогов', () => {
    for (const key of ['victory', 'mutual', 'exhausted', 'peace'] as const) {
      expect(OUTCOME_TITLES[key].length).toBeGreaterThan(0);
    }
  });
});
