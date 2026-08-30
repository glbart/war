import { describe, it, expect } from 'vitest';
import {
  buildPoliticalPixels,
  mapUvToLonLat,
  lonLatToMapUv,
  MAP_W,
  MAP_H,
} from '../../src/render/politicalMap';
import { lonLatToMapUv as toUv } from '../../src/render/politicalMap';
import { factionById } from '../../src/sim/factions';
import { MAP_WATER_COLOR, MAP_FILL_MUTE } from '../../src/assets/config';

const pixelAt = (px: Uint8Array, lonDeg: number, latDeg: number) => {
  const { u, v } = toUv((lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180);
  const x = Math.min(MAP_W - 1, Math.floor(u * MAP_W));
  const y = Math.min(MAP_H - 1, Math.floor(v * MAP_H));
  const o = (y * MAP_W + x) * 4;
  return [px[o]!, px[o + 1]!, px[o + 2]!];
};

describe('Политическая карта', () => {
  const px = buildPoliticalPixels();

  it('картинка нужного размера и непрозрачная', () => {
    expect(px.length).toBe(MAP_W * MAP_H * 4);
    for (let i = 3; i < px.length; i += 4 * 977) expect(px[i]).toBe(255);
  });

  it('океан залит цветом воды', () => {
    const [r, g, b] = pixelAt(px, -140, 0);
    expect(r).toBe(Math.round(MAP_WATER_COLOR[0] * 255));
    expect(g).toBe(Math.round(MAP_WATER_COLOR[1] * 255));
    expect(b).toBe(Math.round(MAP_WATER_COLOR[2] * 255));
  });

  it('страны залиты цветом своей стороны', () => {
    const russia = factionById('russia').color;
    const [r, g, b] = pixelAt(px, 90, 60); // Сибирь — далеко от границ
    expect(r).toBe(Math.round(russia[0] * 255 * MAP_FILL_MUTE));
    expect(g).toBe(Math.round(russia[1] * 255 * MAP_FILL_MUTE));
    expect(b).toBe(Math.round(russia[2] * 255 * MAP_FILL_MUTE));
  });

  it('подсветка делает территорию стороны ярче', () => {
    const lit = buildPoliticalPixels('russia');
    const plain = pixelAt(px, 90, 60);
    const bright = pixelAt(lit, 90, 60);
    expect(bright[0]! + bright[1]! + bright[2]!).toBeGreaterThan(plain[0]! + plain[1]! + plain[2]!);
  });

  it('на карте есть границы — тёмные пиксели на стыках стран', () => {
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i]! < 12 && px[i + 1]! < 12 && px[i + 2]! < 16) dark++;
    }
    expect(dark).toBeGreaterThan(2000); // контуры всех стран мира
  });

  it('проекция и обратная проекция согласованы', () => {
    for (const [lonDeg, latDeg] of [
      [0, 0],
      [37.6, 55.75],
      [-77, 38.9],
      [139.7, 35.7],
    ]) {
      const lon = (lonDeg! * Math.PI) / 180;
      const lat = (latDeg! * Math.PI) / 180;
      const { u, v } = lonLatToMapUv(lon, lat);
      const back = mapUvToLonLat(u, v);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.lat).toBeCloseTo(lat, 6);
    }
  });

  it('карта бесшовна по долготе: u за границей заворачивается', () => {
    expect(mapUvToLonLat(1.25, 0.5).lon).toBeCloseTo(mapUvToLonLat(0.25, 0.5).lon, 6);
  });
});
