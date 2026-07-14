import { describe, it, expect } from 'vitest';
import { buildShardData, ICO_DETAIL } from '../../src/render/shatterShards';
import { SHATTER_PLATE_COUNT } from '../../src/assets/config';

// Треугольников в икосфере с detail подразбиениями: 20 · 4^detail.
const TOTAL_TRIS = 20 * 4 ** ICO_DETAIL;

describe('buildShardData', () => {
  const shards = buildShardData(42);

  it('число кусков и сохранение всех внешних треугольников', () => {
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.length).toBeLessThanOrEqual(SHATTER_PLATE_COUNT);
    const outerTris = shards.reduce((sum, s) => sum + s.outerTriCount, 0);
    expect(outerTris).toBe(TOTAL_TRIS);
  });

  it('каждый кусок — замкнутая оболочка (каждое ребро встречается чётное число раз)', () => {
    for (const s of shards) {
      const edges = new Map<string, number>();
      const key = (x: number, y: number, z: number): string =>
        `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      const p = s.positions;
      for (let t = 0; t < p.length; t += 9) {
        const v = [
          key(p[t]!, p[t + 1]!, p[t + 2]!),
          key(p[t + 3]!, p[t + 4]!, p[t + 5]!),
          key(p[t + 6]!, p[t + 7]!, p[t + 8]!),
        ];
        for (let e = 0; e < 3; e++) {
          const a = v[e]!;
          const b = v[(e + 1) % 3]!;
          const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
          edges.set(ek, (edges.get(ek) ?? 0) + 1);
        }
      }
      for (const [, count] of edges) expect(count % 2).toBe(0);
    }
  });

  it('центры кусков — единичные направления', () => {
    for (const s of shards) {
      const len = Math.hypot(s.center.x, s.center.y, s.center.z);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it('детерминизм: одинаковый seed → одинаковые буферы', () => {
    const again = buildShardData(42);
    expect(again.length).toBe(shards.length);
    expect(Array.from(again[0]!.positions)).toEqual(Array.from(shards[0]!.positions));
  });
});
