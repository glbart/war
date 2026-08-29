import { describe, it, expect } from 'vitest';
import {
  alliesOf,
  responseSize,
  isDoctrine,
  DOCTRINES,
  DEFAULT_DOCTRINE,
  DOCTRINE_NAMES,
} from '../../src/sim/diplomacy';
import { BELLIGERENTS } from '../../src/sim/factions';
import {
  SALVO_COUNT,
  RETALIATION_PER_DEATHS,
  RETALIATION_CAP_ESCALATE,
} from '../../src/assets/config';

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

describe('Дипломатия: размер ответа', () => {
  it('доктрина off и пустой арсенал не дают ответа', () => {
    expect(responseSize(100, 20, 'off', false)).toBe(0);
    expect(responseSize(100, 0, 'restrained', false)).toBe(0);
  });

  it('сдержанный ответ соразмерен потерям и ограничен размером залпа', () => {
    expect(responseSize(RETALIATION_PER_DEATHS, 20, 'restrained', false)).toBe(1);
    expect(responseSize(RETALIATION_PER_DEATHS * 3, 20, 'restrained', false)).toBe(3);
    expect(responseSize(1000, 20, 'restrained', false)).toBe(SALVO_COUNT);
    // даже крошечная потеря — это уже одна ракета в ответ
    expect(responseSize(0.2, 20, 'restrained', false)).toBe(1);
  });

  it('эскалация отвечает вдвое, doomsday — всем арсеналом (в пределах капа)', () => {
    const g = RETALIATION_PER_DEATHS * 2;
    expect(responseSize(g, 30, 'escalate', false)).toBe(4);
    expect(responseSize(1000, 30, 'escalate', false)).toBe(RETALIATION_CAP_ESCALATE);
    expect(responseSize(1, 30, 'doomsday', false)).toBe(RETALIATION_CAP_ESCALATE);
    expect(responseSize(1, 5, 'doomsday', false)).toBe(5); // арсенал меньше капа
  });

  it('за союзника вступаются вполовину, но не меньше одной ракеты', () => {
    const g = RETALIATION_PER_DEATHS * 4;
    expect(responseSize(g, 20, 'restrained', true)).toBe(2);
    expect(responseSize(RETALIATION_PER_DEATHS, 20, 'restrained', true)).toBe(1);
  });

  it('ответ никогда не больше остатка арсенала', () => {
    expect(responseSize(1000, 2, 'escalate', false)).toBe(2);
    expect(responseSize(1000, 1, 'restrained', true)).toBe(1);
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
