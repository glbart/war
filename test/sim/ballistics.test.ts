import { describe, it, expect } from 'vitest';
import {
  slerp3,
  apexFor,
  flightTimeFor,
  ballisticPos,
  ballisticPosInto,
  easeBallistic,
} from '../../src/sim/ballistics';
import { angleBetween, lonLatToDir, type Vec3 } from '../../src/sim/geo';
import {
  BALLISTIC_TIME_MIN,
  BALLISTIC_APEX_MIN,
  BALLISTIC_EASE_POW,
} from '../../src/assets/config';

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const A = lonLatToDir(0.3, 0.9);
const B = lonLatToDir(-2.1, -0.4);

describe('slerp3', () => {
  it('концы точные, промежуточные — единичной длины на дуге', () => {
    expect(slerp3(A, B, 0)).toEqual(A);
    const mid = slerp3(A, B, 0.5);
    expect(len(mid)).toBeCloseTo(1, 6);
    // середина дуги равноудалена от концов
    expect(angleBetween(mid, A)).toBeCloseTo(angleBetween(mid, B), 6);
    const end = slerp3(A, B, 1);
    expect(end.x).toBeCloseTo(B.x, 6);
    expect(end.y).toBeCloseTo(B.y, 6);
    expect(end.z).toBeCloseTo(B.z, 6);
  });

  it('не вырождается на почти совпадающих точках', () => {
    const p = slerp3(A, { ...A }, 0.5);
    expect(len(p)).toBeCloseTo(1, 6);
  });
});

describe('ballisticPos', () => {
  it('старт и цель на поверхности (r=1), апогей в середине', () => {
    expect(len(ballisticPos(A, B, 0))).toBeCloseTo(1, 6);
    expect(len(ballisticPos(A, B, 1))).toBeCloseTo(1, 6);
    const apex = apexFor(angleBetween(A, B));
    // апогей — на середине ДУГИ (e=0.5), то есть при k = 0.5^(1/POW) из-за ease-разгона
    const kApex = 0.5 ** (1 / BALLISTIC_EASE_POW);
    expect(len(ballisticPos(A, B, kApex))).toBeCloseTo(1 + apex, 6);
  });

  it('k=0 — точно точка старта', () => {
    const p = ballisticPos(A, B, 0);
    expect(p.x).toBeCloseTo(A.x, 6);
    expect(p.y).toBeCloseTo(A.y, 6);
    expect(p.z).toBeCloseTo(A.z, 6);
  });
});

describe('ballisticPosInto', () => {
  it('зеркалит ballisticPos на всём диапазоне k', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (let k = 0; k <= 1.0001; k += 0.1) {
      const kk = Math.min(1, k);
      const a = ballisticPos(A, B, kk);
      ballisticPosInto(A, B, kk, out);
      expect(out.x).toBeCloseTo(a.x, 10);
      expect(out.y).toBeCloseTo(a.y, 10);
      expect(out.z).toBeCloseTo(a.z, 10);
    }
  });
});

describe('easeBallistic', () => {
  it('монотонна, медленный старт (разгон), концы точные', () => {
    expect(easeBallistic(0)).toBe(0);
    expect(easeBallistic(1)).toBe(1);
    expect(easeBallistic(0.25)).toBeLessThan(0.25); // первая четверть времени — меньше четверти дуги
    let prev = -1;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const e = easeBallistic(Math.min(1, k));
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
  });
});

describe('дальность → апогей и время', () => {
  it('дальше — выше и дольше; минимумы на нулевой дальности', () => {
    expect(apexFor(0)).toBeCloseTo(BALLISTIC_APEX_MIN, 10);
    expect(apexFor(Math.PI)).toBeGreaterThan(apexFor(1));
    expect(flightTimeFor(0)).toBeCloseTo(BALLISTIC_TIME_MIN, 10);
    expect(flightTimeFor(Math.PI)).toBeGreaterThan(flightTimeFor(1));
  });
});
