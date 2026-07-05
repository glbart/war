// Юнит-тест чистой логики выбора слота (без three.js) — покрывает находку ревью Task 8:
// при исчерпании пула нельзя красть занятый слот у активной ракеты.
import { describe, it, expect } from 'vitest';
import { findFreeSlotIndex, type SlotActivity } from '../../src/render/SlotPool';

function makeSlots(activeFlags: boolean[]): SlotActivity[] {
  return activeFlags.map((active) => ({ active }));
}

describe('SlotPool.findFreeSlotIndex', () => {
  it('возвращает индекс первого свободного слота', () => {
    const slots = makeSlots([true, true, false, true]);
    expect(findFreeSlotIndex(slots)).toBe(2);
  });

  it('пустой пул (все active=false) даёт индекс 0', () => {
    const slots = makeSlots([false, false, false]);
    expect(findFreeSlotIndex(slots)).toBe(0);
  });

  it('все слоты заняты -> undefined, ни один занятый слот не крадётся', () => {
    const slots = makeSlots(new Array(16).fill(true));
    expect(findFreeSlotIndex(slots)).toBeUndefined();
  });

  it('после освобождения слота (despawn) он снова становится доступен', () => {
    const slots = makeSlots(new Array(8).fill(true));
    expect(findFreeSlotIndex(slots)).toBeUndefined();

    // despawn() освобождает конкретный слот (например id найден в слоте 3)
    slots[3] = { active: false };
    expect(findFreeSlotIndex(slots)).toBe(3);
  });

  it('полный пул из 16 (новая вместимость POOL_SIZE) остаётся undefined, а не 0', () => {
    const slots = makeSlots(new Array(16).fill(true));
    const idx = findFreeSlotIndex(slots);
    expect(idx).toBeUndefined();
    expect(idx).not.toBe(0); // регрессия для находки ревью: раньше возвращался slots[0]
  });
});
