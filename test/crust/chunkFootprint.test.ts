import { describe, it, expect } from 'vitest';
import { chunkFootprint } from '../../src/crust/chunkFootprint';

describe('chunkFootprint', () => {
  it('обычный чанк: полигон в границах, без wrap/полюса', () => {
    // чанк в середине грани +X (экватор, lon≈0) — далеко от шва и полюсов
    const fp = chunkFootprint(0, 3, 3);
    expect(fp.wrap).toBe(false);
    expect(fp.poleBand).toBeNull();
    expect(fp.xs.length).toBeGreaterThanOrEqual(4);
    for (const x of fp.xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    for (const y of fp.ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('чанк через шов долготы помечается wrap', () => {
    // середина грани −X (lon≈180°) — полигон пересекает шов
    const fp = chunkFootprint(1, 3, 3);
    expect(fp.wrap).toBe(true);
  });

  it('полюсный чанк даёт poleBand', () => {
    // угловой-центральный чанк грани +Y накрывает северный полюс
    const fp = chunkFootprint(2, 3, 3);
    expect(fp.poleBand).not.toBeNull();
    expect(fp.poleBand!.yMin).toBeLessThan(0.1); // север — верх канвы (y=0)
  });
});
