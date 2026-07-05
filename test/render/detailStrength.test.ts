import { describe, it, expect } from 'vitest';
import { detailStrength } from '../../src/render/effects/detailStrength';

describe('detailStrength', () => {
  it('вблизи (dist≤near) — полная деталь = 1', () => {
    expect(detailStrength(1.5, 2.0, 4.0)).toBeCloseTo(1, 5);
    expect(detailStrength(2.0, 2.0, 4.0)).toBeCloseTo(1, 5);
  });
  it('вдали (dist≥far) — деталь = 0', () => {
    expect(detailStrength(4.0, 2.0, 4.0)).toBeCloseTo(0, 5);
    expect(detailStrength(6.0, 2.0, 4.0)).toBeCloseTo(0, 5);
  });
  it('между — монотонно убывает с дистанцией, в [0,1]', () => {
    const mid = detailStrength(3.0, 2.0, 4.0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(detailStrength(2.5, 2.0, 4.0)).toBeGreaterThan(detailStrength(3.5, 2.0, 4.0));
  });
});
