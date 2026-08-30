import { describe, it, expect } from 'vitest';
import {
  countryAt,
  countryNameAt,
  factionAt,
  factionOfCountryIndex,
  countryRaster,
  COUNTRIES_W,
  COUNTRIES_H,
  COUNTRIES_NONE,
  COUNTRY_ISO,
} from '../../src/sim/countries';
import { FACTIONS, BELLIGERENTS } from '../../src/sim/factions';

const at = (lonDeg: number, latDeg: number) =>
  [(lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180] as const;

describe('Реальные политические границы', () => {
  it('растр разжимается целиком и в нужном размере', () => {
    const r = countryRaster();
    expect(r.length).toBe(COUNTRIES_W * COUNTRIES_H);
    const land = r.reduce((n, v) => n + (v !== COUNTRIES_NONE ? 1 : 0), 0);
    expect(land / r.length).toBeGreaterThan(0.2); // суши примерно треть карты
    expect(land / r.length).toBeLessThan(0.45);
  });

  it('океан ничей, столицы попадают в свои страны', () => {
    expect(countryAt(...at(-140, 0))).toBe(COUNTRIES_NONE); // центр Тихого
    expect(countryNameAt(...at(37.6, 55.75))).toBe('Russia');
    expect(countryNameAt(...at(-77, 38.9))).toBe('United States of America');
    expect(countryNameAt(...at(116.4, 39.9))).toBe('China');
    expect(countryNameAt(...at(2.35, 48.86))).toBe('France');
    expect(countryNameAt(...at(51.4, 35.7))).toBe('Iran');
    expect(countryNameAt(...at(139.7, 35.7))).toBe('Japan');
  });

  it('страны привязаны к сторонам игры, спорные остаются нейтральными', () => {
    expect(factionAt(...at(37.6, 55.75))).toBe('russia');
    expect(factionAt(...at(-98, 39))).toBe('usa');
    expect(factionAt(...at(2.35, 48.86))).toBe('europe');
    expect(factionAt(...at(-2, 53))).toBe('europe'); // Великобритания
    expect(factionAt(...at(51.4, 35.7))).toBe('iran');
    expect(factionAt(...at(-47.9, -15.8))).toBe('brazil');
    expect(factionAt(...at(121, 23.7))).toBe('neutral'); // Тайвань не присваиваем
    expect(factionAt(...at(-140, 0))).toBeUndefined(); // океан
  });

  it('у каждой воюющей стороны есть реальная территория на карте', () => {
    const owners = new Set(
      countryRaster().length > 0
        ? [...countryRaster()].map((idx) => factionOfCountryIndex(idx)).filter(Boolean)
        : [],
    );
    for (const f of BELLIGERENTS) expect(owners.has(f.id), f.name).toBe(true);
  });

  it('коды стран валидны и покрывают весь список', () => {
    expect(COUNTRY_ISO.length).toBeGreaterThan(150);
    for (const code of COUNTRY_ISO) expect(code).toMatch(/^[A-Z]{3}$/);
    expect(FACTIONS.some((f) => f.id === 'neutral')).toBe(true);
  });
});
