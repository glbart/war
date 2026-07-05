import { describe, it, expect } from 'vitest';
import {
  lonLatToDir,
  dirToLonLat,
  dot,
  angleBetween,
  latToTileYf,
  tileYfToLat,
  MAX_MERC_LAT,
} from '../../src/sim/geo';

describe('geo', () => {
  it('lonLatToDir даёт единичный вектор', () => {
    const v = lonLatToDir(0.5, 0.3);
    const len = Math.hypot(v.x, v.y, v.z);
    expect(len).toBeCloseTo(1, 6);
  });
  it('экватор, долгота 0 -> ось +x', () => {
    const v = lonLatToDir(0, 0);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });
  it('северный полюс -> +y', () => {
    const v = lonLatToDir(1.234, Math.PI / 2);
    expect(v.y).toBeCloseTo(1, 6);
  });
  it('angleBetween одинаковых точек = 0', () => {
    const v = lonLatToDir(0.2, 0.2);
    expect(angleBetween(v, v)).toBeCloseTo(0, 6);
    expect(dot(v, v)).toBeCloseTo(1, 6);
  });
  it('tile Y round-trip', () => {
    const n = 1 << 6;
    const lat = tileYfToLat(20.4, n);
    expect(latToTileYf(lat, n)).toBeCloseTo(20.4, 4);
  });
  it('MAX_MERC_LAT около 85.05°', () => {
    expect((MAX_MERC_LAT * 180) / Math.PI).toBeCloseTo(85.0511, 3);
  });
  it('dirToLonLat обратна lonLatToDir', () => {
    for (const [lon, lat] of [
      [0, 0],
      [1.2, -0.5],
      [-2.7, 1.1],
      [Math.PI - 0.01, 0.3],
    ] as const) {
      const d = lonLatToDir(lon, lat);
      const r = dirToLonLat(d);
      expect(r.lon).toBeCloseTo(lon, 6);
      expect(r.lat).toBeCloseTo(lat, 6);
    }
  });
});
