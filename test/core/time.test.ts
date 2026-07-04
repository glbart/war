import { describe, it, expect } from 'vitest';
import { Rng, TICK_DT } from '../../src/core/time';

describe('Rng', () => {
  it('детерминирован при одинаковом seed', () => {
    const a = new Rng(42),
      b = new Rng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });
  it('next() в диапазоне [0,1)', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('range и int работают', () => {
    const r = new Rng(7);
    const x = r.range(10, 20);
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThan(20);
    expect(Number.isInteger(r.int(5))).toBe(true);
  });
  it('TICK_DT = 1/30', () => {
    expect(TICK_DT).toBeCloseTo(1 / 30);
  });
});
