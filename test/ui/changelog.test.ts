import { describe, it, expect } from 'vitest';
import { CHANGELOG, CURRENT_VERSION } from '../../src/assets/changelog';

describe('changelog', () => {
  it('CURRENT_VERSION — версия первой (новейшей) записи', () => {
    expect(CURRENT_VERSION).toBe(CHANGELOG[0]!.version);
  });

  it('версии уникальны, формат X.Y.Z, даты ISO, у каждой записи есть пункты', () => {
    const seen = new Set<string>();
    for (const e of CHANGELOG) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(seen.has(e.version)).toBe(false);
      seen.add(e.version);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.changes.length).toBeGreaterThan(0);
    }
  });

  it('записи отсортированы от новых к старым (по версии и дате)', () => {
    const num = (v: string) => v.split('.').map(Number) as [number, number, number];
    for (let i = 1; i < CHANGELOG.length; i++) {
      const [a1, a2, a3] = num(CHANGELOG[i - 1]!.version);
      const [b1, b2, b3] = num(CHANGELOG[i]!.version);
      expect(a1 * 1e6 + a2 * 1e3 + a3).toBeGreaterThan(b1 * 1e6 + b2 * 1e3 + b3);
      expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
    }
  });
});
