import { describe, it, expect } from 'vitest';
import {
  alliesOf,
  responseSizeForLevel,
  peaceWillingness,
  doctrineCeiling,
  escalationName,
  isDoctrine,
  DOCTRINES,
  DEFAULT_DOCTRINE,
  DOCTRINE_NAMES,
  TEMPERAMENTS,
} from '../../src/sim/diplomacy';
import { BELLIGERENTS } from '../../src/sim/factions';
import {
  SALVO_COUNT,
  RETALIATION_PER_DEATHS,
  RETALIATION_CAP_ESCALATE,
  ESCALATION_MAX,
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

describe('Дипломатия: лестница эскалации и размер ответа', () => {
  it('на нулевом уровне и с пустым арсеналом ответа нет', () => {
    expect(responseSizeForLevel(0, 100, 20, false)).toBe(0);
    expect(responseSizeForLevel(3, 100, 0, false)).toBe(0);
  });

  it('первый уровень — демонстрация одной ракетой, каким бы ни был урон', () => {
    expect(responseSizeForLevel(1, 1, 20, false)).toBe(1);
    expect(responseSizeForLevel(1, 500, 20, false)).toBe(1);
  });

  it('второй уровень — соразмерно потерям, не больше залпа', () => {
    expect(responseSizeForLevel(2, RETALIATION_PER_DEATHS * 3, 20, false)).toBe(3);
    expect(responseSizeForLevel(2, 1000, 20, false)).toBe(SALVO_COUNT);
  });

  it('третий уровень бьёт вдвое сильнее второго, четвёртый — всем арсеналом', () => {
    const g = RETALIATION_PER_DEATHS * 2;
    expect(responseSizeForLevel(3, g, 30, false)).toBe(4);
    expect(responseSizeForLevel(3, 1000, 30, false)).toBe(RETALIATION_CAP_ESCALATE);
    expect(responseSizeForLevel(4, 1, 30, false)).toBe(RETALIATION_CAP_ESCALATE);
    expect(responseSizeForLevel(4, 1, 5, false)).toBe(5);
  });

  it('ответ растёт с уровнем при том же уроне', () => {
    const g = RETALIATION_PER_DEATHS * 3;
    const sizes = [1, 2, 3, 4].map((lvl) => responseSizeForLevel(lvl, g, 30, false));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
  });

  it('за союзника вступаются вполовину, но не меньше одной ракеты', () => {
    expect(responseSizeForLevel(2, RETALIATION_PER_DEATHS * 4, 20, true)).toBe(2);
    expect(responseSizeForLevel(1, 100, 20, true)).toBe(1);
  });

  it('ответ никогда не больше остатка арсенала', () => {
    expect(responseSizeForLevel(3, 1000, 2, false)).toBe(2);
  });
});

describe('Дипломатия: готовность к переговорам', () => {
  const base = {
    temperament: 'balanced' as const,
    doctrine: 'restrained' as const,
    level: 2,
    damageFrac: 0,
    arsenalFrac: 1,
  };

  it('при доктринах «выкл» и «всё сразу» не договариваются вовсе', () => {
    expect(peaceWillingness({ ...base, doctrine: 'off' })).toBe(0);
    expect(peaceWillingness({ ...base, doctrine: 'doomsday' })).toBe(0);
  });

  it('чем больше потерь и меньше арсенал — тем охотнее мир', () => {
    const calm = peaceWillingness(base);
    expect(peaceWillingness({ ...base, damageFrac: 0.6 })).toBeGreaterThan(calm);
    expect(peaceWillingness({ ...base, arsenalFrac: 0.1 })).toBeGreaterThan(calm);
  });

  it('чем выше накал — тем труднее договориться; голубь сговорчивее ястреба', () => {
    expect(peaceWillingness({ ...base, level: 4 })).toBeLessThan(
      peaceWillingness({ ...base, level: 1 }),
    );
    expect(peaceWillingness({ ...base, temperament: 'dove' })).toBeGreaterThan(
      peaceWillingness({ ...base, temperament: 'hawk' }),
    );
  });

  it('значение всегда в границах 0..0.95', () => {
    for (const damageFrac of [-1, 0, 0.5, 1, 2]) {
      for (const arsenalFrac of [-1, 0, 0.5, 1, 2]) {
        const p = peaceWillingness({ ...base, damageFrac, arsenalFrac });
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it('у каждой стороны задан нрав', () => {
    for (const f of BELLIGERENTS) expect(TEMPERAMENTS[f.id]).toBeDefined();
  });
});

describe('Дипломатия: потолок доктрины и названия уровней', () => {
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
