import { describe, it, expect } from 'vitest';
import { dirToFieldUV } from '../../src/render/WaterField';

// Конвенция проекта (src/sim/geo.ts): dirToLonLat = { lon: atan2(-z, x), lat: asin(y) },
// u = (lon+π)/2π, v = (π/2−lat)/π.
describe('dirToFieldUV', () => {
  it('+X (экватор, lon=0) → u=0.5, v=0.5', () => {
    const { u, v } = dirToFieldUV({ x: 1, y: 0, z: 0 });
    expect(u).toBeCloseTo(0.5, 5); // lon=atan2(0,1)=0
    expect(v).toBeCloseTo(0.5, 5); // lat=0
  });

  it('+Z (lon=−π/2) → u=0.25, v=0.5', () => {
    const { u, v } = dirToFieldUV({ x: 0, y: 0, z: 1 });
    expect(u).toBeCloseTo(0.25, 5); // lon=atan2(-1,0)=−π/2
    expect(v).toBeCloseTo(0.5, 5);
  });

  it('северный полюс (+Y) → v≈0', () => {
    const { v } = dirToFieldUV({ x: 0, y: 1, z: 0 });
    expect(v).toBeCloseTo(0, 5); // lat=asin(1)=π/2
  });

  it('u в [0,1] для любых направлений', () => {
    for (const d of [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0.3, z: -1 },
    ]) {
      const { u } = dirToFieldUV(d);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });
});
