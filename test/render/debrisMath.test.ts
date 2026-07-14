import { describe, it, expect } from 'vitest';
import {
  orthoBasis,
  orbitalPos,
  landingDir,
  debrisCount,
  pickMaterial,
  DebrisSlots,
} from '../../src/render/debrisMath';
import { dot, type Vec3 } from '../../src/sim/geo';
import { DEBRIS_MIN, DEBRIS_MAX } from '../../src/assets/config';

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const N: Vec3 = { x: 0.6, y: 0.48, z: 0.64 }; // |N| = 1

describe('orthoBasis', () => {
  it('даёт ортонормированный базис, перпендикулярный нормали', () => {
    const { t1, t2 } = orthoBasis(N);
    expect(len(t1)).toBeCloseTo(1, 6);
    expect(len(t2)).toBeCloseTo(1, 6);
    expect(dot(t1, N)).toBeCloseTo(0, 6);
    expect(dot(t2, N)).toBeCloseTo(0, 6);
    expect(dot(t1, t2)).toBeCloseTo(0, 6);
  });

  it('не вырождается на полюсе (n ≈ +Y)', () => {
    const { t1, t2 } = orthoBasis({ x: 0, y: 1, z: 0 });
    expect(len(t1)).toBeCloseTo(1, 6);
    expect(len(t2)).toBeCloseTo(1, 6);
  });
});

describe('orbitalPos', () => {
  const angle = 1.1,
    omega = 0.4,
    orbitR = 1.4,
    ascentT = 6;

  it('при tau=0 стартует из точки запуска (на поверхности, вдоль n)', () => {
    const p = orbitalPos(N, angle, omega, orbitR, ascentT, 0);
    expect(len(p)).toBeCloseTo(1, 5);
    expect(dot(p, N)).toBeCloseTo(1, 5);
  });

  it('после взлёта радиус выходит на орбитальный', () => {
    const p = orbitalPos(N, angle, omega, orbitR, ascentT, ascentT + 1);
    expect(len(p)).toBeCloseTo(orbitR, 5);
  });

  it('периодична после взлёта: pos(t) ≈ pos(t + 2π/ω)', () => {
    const t0 = ascentT + 2;
    const a = orbitalPos(N, angle, omega, orbitR, ascentT, t0);
    const b = orbitalPos(N, angle, omega, orbitR, ascentT, t0 + (2 * Math.PI) / omega);
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.y).toBeCloseTo(b.y, 5);
    expect(a.z).toBeCloseTo(b.z, 5);
  });
});

describe('landingDir', () => {
  it('единичный вектор, смещённый от эпицентра', () => {
    const d = landingDir(N, 0.3, 0.1);
    expect(len(d)).toBeCloseTo(1, 6);
    expect(dot(d, N)).toBeLessThan(1);
    expect(dot(d, N)).toBeGreaterThan(0.9); // смещение мало
  });
});

describe('debrisCount', () => {
  it('0 выбитых → 0 глыб; иначе кламп [MIN, MAX]', () => {
    expect(debrisCount(0)).toBe(0);
    expect(debrisCount(1)).toBe(DEBRIS_MIN);
    expect(debrisCount(10_000)).toBe(DEBRIS_MAX);
    expect(debrisCount(300)).toBe(100); // 300 · (1/3)
  });
});

describe('pickMaterial', () => {
  const byMat = { soil: 50, rock: 30, basalt: 20 };
  it('делит [0,1) пропорционально долям материалов', () => {
    expect(pickMaterial(0.0, byMat)).toBe('soil');
    expect(pickMaterial(0.49, byMat)).toBe('soil');
    expect(pickMaterial(0.51, byMat)).toBe('rock');
    expect(pickMaterial(0.79, byMat)).toBe('rock');
    expect(pickMaterial(0.81, byMat)).toBe('basalt');
    expect(pickMaterial(0.999, byMat)).toBe('basalt');
  });
  it('пустая разбивка не делит на ноль', () => {
    expect(pickMaterial(0.5, { soil: 0, rock: 0, basalt: 0 })).toBe('rock');
  });
});

describe('DebrisSlots', () => {
  it('орбитальные и баллистические сегменты не пересекаются и заворачиваются', () => {
    const s = new DebrisSlots(3, 2);
    expect([s.nextOrbital(), s.nextOrbital(), s.nextOrbital(), s.nextOrbital()]).toEqual([
      0, 1, 2, 0,
    ]);
    expect([s.nextBallistic(), s.nextBallistic(), s.nextBallistic()]).toEqual([3, 4, 3]);
  });
  it('reset обнуляет курсоры', () => {
    const s = new DebrisSlots(3, 2);
    s.nextOrbital();
    s.nextBallistic();
    s.reset();
    expect(s.nextOrbital()).toBe(0);
    expect(s.nextBallistic()).toBe(3);
  });
});
