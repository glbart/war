import { describe, it, expect } from 'vitest';
import { ballisticHeight } from '../../src/render/EjectaView';

describe('ballisticHeight', () => {
  it('стартует у поверхности, поднимается, падает обратно к нулю', () => {
    const v0 = 1,
      g = 2;
    expect(ballisticHeight(v0, g, 0)).toBeCloseTo(0, 5);
    const peakT = v0 / g; // вершина параболы
    expect(ballisticHeight(v0, g, peakT)).toBeGreaterThan(0);
    // симметрично: к моменту 2·peakT вернулась к 0
    expect(ballisticHeight(v0, g, 2 * peakT)).toBeCloseTo(0, 5);
  });

  it('не уходит ниже нуля (клампится у поверхности)', () => {
    expect(ballisticHeight(1, 2, 5)).toBeGreaterThanOrEqual(0);
  });

  it('вершина выше при большей начальной скорости', () => {
    const g = 2;
    const peak = (v: number) => ballisticHeight(v, g, v / g);
    expect(peak(2)).toBeGreaterThan(peak(1));
  });
});
