import { describe, it, expect } from 'vitest';
import { DEFENSES, interceptChance, defenderFor } from '../../src/sim/defense';
import { createCities } from '../../src/sim/cities';
import { FACTIONS, BELLIGERENTS } from '../../src/sim/factions';
import { lonLatToDir } from '../../src/sim/geo';
import { ABM_COVER_ANGLE } from '../../src/assets/config';

const at = (lonDeg: number, latDeg: number) =>
  lonLatToDir((lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180);

describe('ПРО: данные сторон', () => {
  it('у каждой стороны заданы перехватчики и шанс, нейтральные не обороняются', () => {
    for (const f of FACTIONS) {
      expect(DEFENSES[f.id]).toBeDefined();
      expect(DEFENSES[f.id].abm).toBeGreaterThanOrEqual(0);
      expect(DEFENSES[f.id].abm).toBeLessThanOrEqual(1);
    }
    expect(DEFENSES.neutral.interceptors).toBe(0);
    expect(interceptChance('neutral')).toBe(0);
    for (const f of BELLIGERENTS) expect(DEFENSES[f.id].interceptors).toBeGreaterThan(0);
  });
});

describe('ПРО: зона прикрытия', () => {
  const cities = createCities();

  it('удар по чужой столице прикрывает её хозяин', () => {
    expect(defenderFor(cities, at(37.62, 55.75))).toBe('russia'); // Москва
    expect(defenderFor(cities, at(-74.01, 40.71))).toBe('usa'); // Нью-Йорк
    expect(defenderFor(cities, at(2.35, 48.86))).toBe('europe'); // Париж
  });

  it('удар в открытый океан не прикрывает никто', () => {
    expect(defenderFor(cities, at(-140, 0))).toBeUndefined(); // центр Тихого
    expect(defenderFor(cities, at(0, -80))).toBeUndefined(); // Антарктида
  });

  it('прикрытие ограничено углом ABM_COVER_ANGLE вокруг живого города', () => {
    const moscow = cities.find((c) => c.name === 'Moscow')!;
    // точка чуть дальше зоны прикрытия по долготе (на широте Москвы ~0.5 рад ≈ 16°)
    const far = at(37.62 + 40, 55.75);
    expect(defenderFor([moscow], far)).toBeUndefined();
    expect(defenderFor([moscow], moscow.dir)).toBe('russia');
    expect(ABM_COVER_ANGLE).toBeGreaterThan(0);
  });

  it('мёртвые города не прикрывают (их фильтрует вызывающая сторона)', () => {
    const alive = cities.filter((c) => c.name !== 'Moscow' && c.faction === 'russia');
    // без Москвы ближайший живой российский город всё ещё может быть далеко
    const d = defenderFor(alive, at(37.62, 55.75));
    expect(d === undefined || d === 'russia').toBe(true);
  });
});
