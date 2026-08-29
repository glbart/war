import { describe, it, expect } from 'vitest';
import {
  alliesOf,
  doctrineCeiling,
  escalationName,
  isDoctrine,
  DOCTRINES,
  DEFAULT_DOCTRINE,
  DOCTRINE_NAMES,
  TEMPERAMENTS,
} from '../../src/sim/diplomacy';
import { BELLIGERENTS } from '../../src/sim/factions';
import { ESCALATION_MAX } from '../../src/assets/config';

describe('Дипломатия: союзники', () => {
  it('союзы симметричны и не включают саму сторону', () => {
    for (const f of BELLIGERENTS) {
      for (const ally of alliesOf(f.id)) {
        expect(ally).not.toBe(f.id);
        expect(alliesOf(ally)).toContain(f.id);
      }
    }
  });

  it('нейтральные ни с кем не связаны, у Индии и Пакистана союзников нет', () => {
    expect(alliesOf('neutral')).toEqual([]);
    expect(alliesOf('india')).toEqual([]);
    expect(alliesOf('pakistan')).toEqual([]);
    expect(alliesOf('usa')).toContain('europe');
    expect(alliesOf('russia')).toContain('china');
  });
});

describe('Дипломатия: потолок доктрины и названия уровней', () => {
  it('у каждой стороны задан нрав', () => {
    for (const f of BELLIGERENTS) expect(TEMPERAMENTS[f.id]).toBeDefined();
  });

  it('потолок растёт от «выкл» к «всё сразу»', () => {
    expect(doctrineCeiling('off')).toBe(0);
    expect(doctrineCeiling('restrained')).toBe(2);
    expect(doctrineCeiling('escalate')).toBe(3);
    expect(doctrineCeiling('doomsday')).toBe(ESCALATION_MAX);
  });

  it('у каждого уровня есть человеческое название, выход за границы клампится', () => {
    for (let lvl = 0; lvl <= ESCALATION_MAX; lvl++)
      expect(escalationName(lvl).length).toBeGreaterThan(0);
    expect(escalationName(-5)).toBe(escalationName(0));
    expect(escalationName(99)).toBe(escalationName(ESCALATION_MAX));
  });
});

describe('Дипломатия: доктрины', () => {
  it('список доктрин, названия и проверка типа согласованы', () => {
    expect(DOCTRINES).toContain(DEFAULT_DOCTRINE);
    for (const d of DOCTRINES) {
      expect(isDoctrine(d)).toBe(true);
      expect(DOCTRINE_NAMES[d].length).toBeGreaterThan(0);
    }
    expect(isDoctrine('первый удар')).toBe(false);
    expect(isDoctrine(7)).toBe(false);
  });
});
