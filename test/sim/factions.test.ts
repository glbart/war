import { describe, it, expect } from 'vitest';
import {
  FACTIONS,
  BELLIGERENTS,
  NUCLEAR_POWERS,
  ASPIRANTS,
  FACTION_CITIES,
  factionOfCity,
  factionById,
  isFactionId,
  type FactionId,
} from '../../src/sim/factions';
import { createCities, cityNames } from '../../src/sim/cities';

describe('Стороны конфликта', () => {
  it('все города из списков сторон существуют в данных городов (страховка от опечаток)', () => {
    const known = new Set(cityNames());
    const missing: string[] = [];
    for (const names of Object.values(FACTION_CITIES)) {
      for (const name of names) if (!known.has(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('списки сторон не пересекаются: город принадлежит ровно одной стороне', () => {
    const seen = new Map<string, FactionId>();
    const dup: string[] = [];
    for (const [id, names] of Object.entries(FACTION_CITIES)) {
      for (const name of names) {
        if (seen.has(name)) dup.push(`${name}: ${seen.get(name)} и ${id}`);
        seen.set(name, id as FactionId);
      }
    }
    expect(dup).toEqual([]);
  });

  it('у ядерных держав есть арсенал, у претендентов — нет, но города есть у всех', () => {
    for (const f of BELLIGERENTS) {
      const cities = createCities().filter((c) => c.faction === f.id);
      expect(cities.length, f.name).toBeGreaterThan(0);
      if (f.aspirant) expect(f.arsenal, f.name).toBe(0);
      else expect(f.arsenal, f.name).toBeGreaterThan(0);
    }
  });

  it('претенденты и ядерные державы вместе дают всех воюющих', () => {
    expect(NUCLEAR_POWERS.length + ASPIRANTS.length).toBe(BELLIGERENTS.length);
    expect(ASPIRANTS.every((f) => f.aspirant === true)).toBe(true);
    expect(NUCLEAR_POWERS.every((f) => f.aspirant !== true)).toBe(true);
  });

  it('нейтральные — псевдо-сторона без арсенала, туда попадают города вне списков', () => {
    expect(factionById('neutral').arsenal).toBe(0);
    expect(factionOfCity('Jakarta')).toBe('neutral'); // страна вне списков — нейтральный город
    expect(factionOfCity('Такого города нет')).toBe('neutral');
    expect(BELLIGERENTS.some((f) => f.id === 'neutral')).toBe(false);
  });

  it('таблица FACTIONS полна и уникальна по id, цвета — тройки в 0..1', () => {
    const ids = FACTIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(factionById(id).id).toBe(id);
    for (const f of FACTIONS) {
      expect(f.color).toHaveLength(3);
      for (const ch of f.color) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
  });

  it('isFactionId отсекает чужие значения (граница команд/сети)', () => {
    expect(isFactionId('usa')).toBe(true);
    expect(isFactionId('neutral')).toBe(true);
    expect(isFactionId('atlantis')).toBe(false);
    expect(isFactionId(42)).toBe(false);
  });

  it('города размечены по сторонам: известные принадлежности на месте', () => {
    const cities = createCities();
    const of = (name: string) => cities.find((c) => c.name === name)!.faction;
    expect(of('Moscow')).toBe('russia');
    expect(of('New York')).toBe('usa');
    expect(of('Beijing')).toBe('china');
    expect(of('Paris')).toBe('europe');
    expect(of('Delhi')).toBe('india');
    expect(of('Karachi')).toBe('pakistan');
    expect(of('Pyongyang')).toBe('dprk');
    expect(of('Jerusalem')).toBe('israel');
    expect(of('São Paulo')).toBe('brazil');
    expect(of('Tokyo')).toBe('japan');
    expect(of('Tehran')).toBe('iran');
    expect(of('Jakarta')).toBe('neutral');
  });

  it('сумма населения по сторонам равна суммарному населению всех городов', () => {
    const cities = createCities();
    const total = cities.reduce((s, c) => s + c.pop, 0);
    const byFaction = FACTIONS.reduce(
      (s, f) => s + cities.filter((c) => c.faction === f.id).reduce((a, c) => a + c.pop, 0),
      0,
    );
    expect(byFaction).toBeCloseTo(total, 6);
  });
});
