import { describe, it, expect } from 'vitest';
import { buildCoastData } from '../../src/render/CoastField';

// Синтетическая маска: левая половина — суша, правая — океан.
const leftHalfLand = (lon: number): boolean => lon < 0; // lon∈[-π,π): <0 = западное полушарие = суша

// Долгота оборачивается (антимеридиан ±π — тот же меридиан, RepeatWrapping): у такой маски
// суша — сплошная дуга полукруга, значит у неё ДВЕ береговые линии — на lon=0 и на lon=±π
// (шов оборачивания). Поэтому «глубокий океан» — это НЕ последний тексель массива (px=w-1
// соседствует по шву с сушей px=0, дистанция там мала), а точка ровно посередине океанской
// дуги, диаметрально противоположная суше (lon=π/2, px=0.75·w) — она равноудалена от обеих
// береговых линий и на большом w (>4·SPREAD_ITERS) достигает насыщения в 255.
const w = 128;
const deepOceanPx = Math.floor(w * 0.75);

describe('buildCoastData', () => {
  it('суша = 0, открытый океан = 255', () => {
    const h = 8;
    const data = buildCoastData((lon) => leftHalfLand(lon), w, h);
    // тексель глубоко в суше (px=1) — 0
    expect(data[3 * w + 1]).toBe(0);
    // тексель в глубине океана (максимально далеко от обеих береговых линий) — 255
    expect(data[3 * w + deepOceanPx]).toBe(255);
  });

  it('у берега значение меньше, чем в открытом океане (градиент расстояния)', () => {
    const h = 8;
    const data = buildCoastData((lon) => leftHalfLand(lon), w, h);
    const row = 4 * w;
    // px чуть правее границы суша/океан (~середина массива) — берег, значение мало
    const nearCoast = data[row + (w / 2 + 1)]!;
    // px в глубине океана — значение велико
    const openOcean = data[row + deepOceanPx]!;
    expect(nearCoast).toBeLessThan(openOcean);
    expect(nearCoast).toBeGreaterThan(0); // это океан, не суша
  });

  it('детерминизм: одинаковый вход → идентичный выход', () => {
    const a = buildCoastData((lon) => leftHalfLand(lon), 16, 8);
    const b = buildCoastData((lon) => leftHalfLand(lon), 16, 8);
    expect(a).toEqual(b);
  });
});
