import { describe, it, expect } from 'vitest';
import { craterProfile } from '../../src/render/effects/craterProfile';

describe('craterProfile', () => {
  it('чаша: глубина максимальна в центре, спадает к краю', () => {
    expect(craterProfile(0).depth).toBeCloseTo(1, 2);
    expect(craterProfile(1).depth).toBeLessThan(0.1);
    expect(craterProfile(0).depth).toBeGreaterThan(craterProfile(0.5).depth);
  });

  it('вал: приподнят ЗА краем чаши (dNorm>1), в центре вала нет', () => {
    expect(craterProfile(0).rim).toBeLessThan(0.1);
    // где-то в районе вала rim заметно выше нуля
    const around = [1.1, 1.2, 1.3, 1.4].map((d) => craterProfile(d).rim);
    expect(Math.max(...around)).toBeGreaterThan(0.5);
  });

  it('эжекта: спадает к периферии', () => {
    const near = craterProfile(1.3).ejecta;
    const far = craterProfile(2.5).ejecta;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan(0.15);
  });

  it('гарь: широкий мягкий градиент, не обрывается на краю чаши', () => {
    // на краю чаши гарь ещё заметна (не 0), т.е. шире воронки
    expect(craterProfile(1).scorch).toBeGreaterThan(0.2);
    expect(craterProfile(0).scorch).toBeGreaterThan(craterProfile(1.5).scorch);
  });

  it('все выходы в [0,1]', () => {
    for (let d = 0; d <= 3; d += 0.1) {
      const p = craterProfile(d);
      for (const v of [p.depth, p.rim, p.ejecta, p.scorch]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
