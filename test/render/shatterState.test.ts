import { describe, it, expect } from 'vitest';
import { ShatterState } from '../../src/render/shatterState';
import {
  SHATTER_AGONY_T,
  SHATTER_CORE_LINGER_T,
  SHATTER_CORE_COLLAPSE_T,
} from '../../src/assets/config';

describe('ShatterState', () => {
  it('intact: update ничего не делает, boost=0', () => {
    const s = new ShatterState();
    expect(s.phase).toBe('intact');
    expect(s.update(1)).toBeNull();
    expect(s.boost).toBe(0);
  });

  it('trigger переводит в агонию; boost растёт линейно до 1 за SHATTER_AGONY_T', () => {
    const s = new ShatterState();
    s.trigger();
    expect(s.phase).toBe('agony');
    s.update(SHATTER_AGONY_T / 2);
    expect(s.boost).toBeCloseTo(0.5, 10);
  });

  it("переход в shattered возвращает 'shatter' ровно один раз; после boost=1", () => {
    const s = new ShatterState();
    s.trigger();
    expect(s.update(SHATTER_AGONY_T + 0.1)).toBe('shatter');
    expect(s.phase).toBe('shattered');
    expect(s.boost).toBe(1);
    expect(s.update(1)).toBeNull(); // второй раз события нет
  });

  it('повторный trigger в agony/shattered — no-op', () => {
    const s = new ShatterState();
    s.trigger();
    s.update(SHATTER_AGONY_T / 2);
    const b = s.boost;
    s.trigger();
    expect(s.phase).toBe('agony');
    expect(s.boost).toBe(b); // агония не перезапустилась
    s.update(SHATTER_AGONY_T);
    s.trigger();
    expect(s.phase).toBe('shattered');
  });

  it('reset из любой фазы возвращает intact/0', () => {
    const s = new ShatterState();
    s.trigger();
    s.update(SHATTER_AGONY_T + 1);
    s.reset();
    expect(s.phase).toBe('intact');
    expect(s.boost).toBe(0);
    expect(s.update(1)).toBeNull();
  });

  it("после паузы SHATTER_CORE_LINGER_T начинается распад ядра: 'collapse' ровно один раз", () => {
    const s = new ShatterState();
    s.trigger();
    expect(s.update(SHATTER_AGONY_T + 0.1)).toBe('shatter');
    expect(s.coreProgress).toBe(0);
    expect(s.update(SHATTER_CORE_LINGER_T - 1)).toBeNull(); // ядро ещё висит
    expect(s.phase).toBe('shattered');
    expect(s.update(1.5)).toBe('collapse'); // порог пройден
    expect(s.phase).toBe('collapse');
    expect(s.update(0.1)).toBeNull(); // второй раз события нет
  });

  it('coreProgress растёт 0→1 за SHATTER_CORE_COLLAPSE_T, затем фаза gone', () => {
    const s = new ShatterState();
    s.trigger();
    s.update(SHATTER_AGONY_T + 0.1);
    s.update(SHATTER_CORE_LINGER_T + 0.001); // старт распада (прогресс ≈ 0)
    expect(s.coreProgress).toBeCloseTo(0, 2);
    s.update(SHATTER_CORE_COLLAPSE_T / 2);
    expect(s.coreProgress).toBeCloseTo(0.5, 2);
    s.update(SHATTER_CORE_COLLAPSE_T);
    expect(s.phase).toBe('gone');
    expect(s.coreProgress).toBe(1);
    expect(s.boost).toBe(1); // буст трещин остаётся максимальным (куски всё ещё светятся)
    expect(s.update(1)).toBeNull();
  });

  it('reset из collapse/gone тоже возвращает intact и обнуляет coreProgress', () => {
    const s = new ShatterState();
    s.trigger();
    s.update(SHATTER_AGONY_T + 0.1);
    s.update(SHATTER_CORE_LINGER_T + SHATTER_CORE_COLLAPSE_T + 1);
    s.reset();
    expect(s.phase).toBe('intact');
    expect(s.coreProgress).toBe(0);
  });
});
