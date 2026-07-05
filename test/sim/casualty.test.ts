import { describe, it, expect } from 'vitest';
import { createCities } from '../../src/sim/cities';
import { computeCasualties } from '../../src/ecs/systems/CasualtySystem';
import { lonLatToDir } from '../../src/sim/geo';

const moscow = lonLatToDir((37.62 * Math.PI) / 180, (55.75 * Math.PI) / 180);

describe('computeCasualties', () => {
  it('прямое попадание по Москве убивает ~всё население города', () => {
    const cities = createCities();
    const before = cities.find((c) => c.name === 'Moscow')!.alive;
    const { hits, totalDeaths } = computeCasualties(cities, moscow, 100, 1.4);
    const mos = hits.find((h) => h.name === 'Moscow')!;
    expect(mos.deaths).toBeGreaterThan(before * 0.9);
    expect(totalDeaths).toBeGreaterThan(mos.deaths);
    expect(mos.atWaveTime).toBeGreaterThanOrEqual(0);
  });
  it('повторный удар не убивает уже погибших', () => {
    const cities = createCities();
    computeCasualties(cities, moscow, 100, 1.4);
    const second = computeCasualties(cities, moscow, 100, 1.4);
    const mos = second.hits.find((h) => h.name === 'Moscow');
    expect(mos === undefined || mos.deaths < 0.05).toBe(true);
  });
  it('удар в океан (0N,0E) никого не задевает', () => {
    const cities = createCities();
    const { totalDeaths } = computeCasualties(cities, lonLatToDir(0, 0), 1, 0.8);
    expect(totalDeaths).toBeLessThan(0.5);
  });
});
