import { describe, it, expect } from 'vitest';
import { isLand } from '../../src/sim/landmask';

const D = Math.PI / 180;

describe('landmask', () => {
  it('Сахара — суша', () => {
    expect(isLand(15 * D, 23 * D)).toBe(true);
  });
  it('центр Тихого океана — вода', () => {
    expect(isLand(-140 * D, 0)).toBe(false);
  });
  it('Антарктида — суша', () => {
    expect(isLand(0, -82 * D)).toBe(true);
  });
  it('Атлантика между Африкой и Ю.Америкой — вода', () => {
    expect(isLand(-20 * D, -5 * D)).toBe(false);
  });
});
