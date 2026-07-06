import { describe, it, expect } from 'vitest';
import { Crust, MAT_EMPTY, MAT_WATER } from '../../src/crust/Crust';
import { lonLatToDir } from '../../src/sim/geo';
import { dirToFaceUV } from '../../src/crust/cubesphere';
import { CRUST_FACE_N } from '../../src/assets/config';

const deg = (x: number) => (x * Math.PI) / 180;
const SAHARA = lonLatToDir(deg(20), deg(23));
const PACIFIC = lonLatToDir(deg(-140), 0);

describe('Crust.carve', () => {
  it('удар по суше выбивает воксели и возвращает задетые чанки', () => {
    const crust = new Crust();
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    expect(res.removed).toBeGreaterThan(50);
    expect(res.changed.length).toBeGreaterThan(0);
    expect(crust.removedVoxels).toBe(res.removed);
  });

  it('детерминизм: одинаковые аргументы → одинаковый результат', () => {
    const a = new Crust().carve(SAHARA, 0.046, 5, 42);
    const b = new Crust().carve(SAHARA, 0.046, 5, 42);
    expect(a.removed).toBe(b.removed);
    expect(a.changed).toEqual(b.changed);
  });

  it('повторный удар в ту же точку копает глубже (кумулятивно)', () => {
    const crust = new Crust();
    const r1 = crust.carve(SAHARA, 0.046, 5, 1);
    const r2 = crust.carve(SAHARA, 0.046, 5, 2);
    expect(r2.removed).toBeGreaterThan(0); // второй удар тоже выбивает (углубляет)
    expect(crust.removedVoxels).toBe(r1.removed + r2.removed);
  });

  it('океан не карвится', () => {
    const crust = new Crust();
    const res = crust.carve(PACIFIC, 0.046, 5, 42);
    expect(res.removed).toBe(0);
  });

  it('выбитые воксели действительно пустые (в центре удара)', () => {
    const crust = new Crust();
    crust.carve(SAHARA, 0.046, 5, 42);
    // после удара по центру: верхний воксель столбца эпицентра пуст
    const { face, u, v } = dirToFaceUV(SAHARA);
    const x = Math.floor(u * CRUST_FACE_N);
    const y = Math.floor(v * CRUST_FACE_N);
    const top = crust.getVoxel(face, x, y, 0);
    expect([MAT_EMPTY, MAT_WATER]).toContain(top);
    expect(top).toBe(MAT_EMPTY);
  });
});
