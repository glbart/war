import { describe, it, expect } from 'vitest';
import { biomeRGB } from '../../src/render/biome';

describe('biomeRGB', () => {
  it('океан синеватый (b > r)', () => {
    const [r, , b] = biomeRGB('ocean');
    expect(b).toBeGreaterThan(r);
  });
  it('пустыня тёплая (r > b)', () => {
    const [r, , b] = biomeRGB('desert');
    expect(r).toBeGreaterThan(b);
  });
  it('лёд светлый (все каналы > 0.8)', () => {
    expect(biomeRGB('ice').every((c) => c > 0.8)).toBe(true);
  });
});
