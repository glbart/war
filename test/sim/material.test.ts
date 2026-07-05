import { describe, it, expect } from 'vitest';
import { biomeForLand, materialAt, materialAtDir } from '../../src/sim/material';
import { lonLatToDir } from '../../src/sim/geo';

const D = Math.PI / 180;

describe('biomeForLand (правила, без шума)', () => {
  it('экватор — лес', () => expect(biomeForLand(5 * D, 0)).toBe('forest'));
  it('~25° — пустыня', () => expect(biomeForLand(25 * D, 0)).toBe('desert'));
  it('~40° — степь', () => expect(biomeForLand(40 * D, 0)).toBe('grass'));
  it('~60° — тундра', () => expect(biomeForLand(60 * D, 0)).toBe('tundra'));
  it('~72° — лёд', () => expect(biomeForLand(72 * D, 0)).toBe('ice'));
});

describe('materialAt', () => {
  it('океан — вода/ocean', () => {
    const m = materialAt(-140 * D, 0);
    expect(m.surface).toBe('water');
    expect(m.biome).toBe('ocean');
  });
  it('Сахара — суша/пустыня', () => {
    const m = materialAt(15 * D, 23 * D);
    expect(m.surface).toBe('land');
    expect(m.biome).toBe('desert');
  });
  it('Антарктида — лёд', () => {
    const m = materialAt(0, -82 * D);
    expect(m.surface).toBe('ice');
    expect(m.biome).toBe('ice');
  });
  it('детерминизм', () => {
    expect(materialAt(1.1, 0.4)).toEqual(materialAt(1.1, 0.4));
  });
  it('materialAtDir согласован с materialAt', () => {
    const dir = lonLatToDir(0.7, -0.2);
    expect(materialAtDir(dir)).toEqual(materialAt(0.7, -0.2));
  });
});
