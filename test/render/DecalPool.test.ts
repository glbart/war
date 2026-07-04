// Юнит-тест чистой логики кольцевого пула декалей (без three.js) — покрывает лимит 512
// (здесь проверяем на маленькой ёмкости) и переиспользование самого старого слота.
import { describe, it, expect } from 'vitest';
import { RingCursor } from '../../src/render/DecalPool';

describe('DecalPool.RingCursor', () => {
  it('пока пул не заполнен — индексы растут 0,1,2,... (заводим новые слоты)', () => {
    const cursor = new RingCursor(3);
    expect(cursor.next()).toBe(0);
    expect(cursor.next()).toBe(1);
    expect(cursor.next()).toBe(2);
  });

  it('после заполнения переиспользует самый старый слот по кругу (FIFO)', () => {
    const cursor = new RingCursor(3);
    cursor.next(); // 0
    cursor.next(); // 1
    cursor.next(); // 2 — пул заполнен
    expect(cursor.next()).toBe(0); // самый старый — слот 0
    expect(cursor.next()).toBe(1);
    expect(cursor.next()).toBe(2);
    expect(cursor.next()).toBe(0);
  });

  it('reset() возвращает пул к заполнению с нуля (как на planetReset)', () => {
    const cursor = new RingCursor(2);
    cursor.next(); // 0
    cursor.next(); // 1
    cursor.next(); // 0 (переиспользован)
    cursor.reset();
    expect(cursor.next()).toBe(0);
    expect(cursor.next()).toBe(1);
  });

  it('ёмкость 512 (реальный лимит DecalView): 512-й вызов ещё новый слот, 513-й — переиспользование слота 0', () => {
    const cursor = new RingCursor(512);
    let last = -1;
    for (let i = 0; i < 512; i++) last = cursor.next();
    expect(last).toBe(511);
    expect(cursor.next()).toBe(0);
  });
});
