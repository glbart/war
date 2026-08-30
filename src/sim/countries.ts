// Реальные политические границы (спека 2026-08-29-flat-map-design.md, ревизия: вместо Вороного
// по городам — настоящие контуры). Данные испечены из Natural Earth 1:110m в
// countries.data.ts; здесь — ленивый декодер RLE и привязка стран к сторонам игры.

import {
  COUNTRIES_W,
  COUNTRIES_H,
  COUNTRIES_NONE,
  COUNTRY_ISO,
  COUNTRY_NAMES,
  COUNTRIES_RLE_B64,
} from './countries.data';
import type { FactionId } from './factions';

export { COUNTRIES_W, COUNTRIES_H, COUNTRIES_NONE, COUNTRY_ISO, COUNTRY_NAMES };

// Ленивое разжатие RLE (значение, длина uint16) → растр индексов стран. Тот же приём, что и
// у landmask: в рантайме ни сети, ни зависимостей.
let raster: Uint8Array | null = null;
export function countryRaster(): Uint8Array {
  if (raster) return raster;
  const bin = atob(COUNTRIES_RLE_B64);
  const out = new Uint8Array(COUNTRIES_W * COUNTRIES_H);
  let at = 0;
  for (let i = 0; i + 2 < bin.length; i += 3) {
    const value = bin.charCodeAt(i);
    const len = (bin.charCodeAt(i + 1) << 8) | bin.charCodeAt(i + 2);
    out.fill(value, at, Math.min(out.length, at + len));
    at += len;
  }
  raster = out;
  return out;
}

// Индекс страны в точке (lonRad ∈ [-π,π], latRad ∈ [-π/2,π/2]) или COUNTRIES_NONE.
export function countryAt(lonRad: number, latRad: number): number {
  const u = (lonRad + Math.PI) / (2 * Math.PI);
  const v = (Math.PI / 2 - latRad) / Math.PI;
  const x = Math.min(COUNTRIES_W - 1, Math.max(0, Math.floor(u * COUNTRIES_W)));
  const y = Math.min(COUNTRIES_H - 1, Math.max(0, Math.floor(v * COUNTRIES_H)));
  return countryRaster()[y * COUNTRIES_W + x]!;
}

// Кто чем владеет в нашей игре. Европа — блок из спеки фракций (ЕС + Великобритания +
// Норвегия/Швейцария/Исландия), США — со своими территориями. Спорные принадлежности не
// присваиваем: Тайвань, Косово, Северный Кипр и т.п. остаются нейтральными.
const FACTION_COUNTRIES: Record<Exclude<FactionId, 'neutral'>, readonly string[]> = {
  usa: ['USA', 'PRI'],
  russia: ['RUS'],
  china: ['CHN'],
  europe: [
    'GBR',
    'FRA',
    'DEU',
    'ITA',
    'ESP',
    'PRT',
    'NLD',
    'BEL',
    'LUX',
    'AUT',
    'CHE',
    'IRL',
    'DNK',
    'SWE',
    'NOR',
    'FIN',
    'ISL',
    'POL',
    'CZE',
    'SVK',
    'HUN',
    'ROU',
    'BGR',
    'GRC',
    'HRV',
    'SVN',
    'EST',
    'LVA',
    'LTU',
  ],
  india: ['IND'],
  pakistan: ['PAK'],
  dprk: ['PRK'],
  israel: ['ISR'],
  iran: ['IRN'],
  saudi: ['SAU'],
  turkey: ['TUR'],
  egypt: ['EGY'],
  japan: ['JPN'],
  korea: ['KOR'],
  brazil: ['BRA'],
  safrica: ['ZAF'],
};

// Индекс страны → сторона игры. Считается один раз по таблице выше.
const INDEX_TO_FACTION: FactionId[] = COUNTRY_ISO.map((code) => {
  for (const [faction, codes] of Object.entries(FACTION_COUNTRIES)) {
    if (codes.includes(code)) return faction as FactionId;
  }
  return 'neutral';
});

export function factionOfCountryIndex(index: number): FactionId | undefined {
  return index === COUNTRIES_NONE ? undefined : INDEX_TO_FACTION[index];
}

// Сторона, владеющая точкой (или undefined над водой).
export function factionAt(lonRad: number, latRad: number): FactionId | undefined {
  return factionOfCountryIndex(countryAt(lonRad, latRad));
}

export function countryNameAt(lonRad: number, latRad: number): string | undefined {
  const idx = countryAt(lonRad, latRad);
  return idx === COUNTRIES_NONE ? undefined : COUNTRY_NAMES[idx];
}
