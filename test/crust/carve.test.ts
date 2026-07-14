import { describe, it, expect } from 'vitest';
import {
  Crust,
  MAT_EMPTY,
  MAT_WATER,
  carveMaskRadius,
  crackStrengthForDepth,
} from '../../src/crust/Crust';
import { dot, lonLatToDir } from '../../src/sim/geo';
import { dirToFaceUV, type FaceId } from '../../src/crust/cubesphere';
import { CRUST_FACE_N, CRUST_CHUNK, CRUST_DOOM_VOXELS } from '../../src/assets/config';

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
    // ничего не стёрто → ни один чанк не должен материализоваться (ленивость хранения)
    expect(crust.materializedChunks).toBe(0);
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

  // Инвариант (см. ревью Task 11): каждый пиксель диска маски дырок (HoleMask.markCarve,
  // радиус carveMaskRadius(radiusRad)) лежит над чанком, который carve() пометил в changed —
  // иначе у границы чанка маска накрывает соседа, где меш не перестроен → сквозная дыра.
  // Проверяем ВСЕ столбцы всех 6 граней, а не только эпицентральный чанк — это ловит и случай,
  // когда диск маски накрывает соседние чанки через границу.
  function assertMaskCoveredByChangedChunks(
    dir: ReturnType<typeof lonLatToDir>,
    radiusRad: number,
    depthVox: number,
    seed: number,
  ): void {
    const crust = new Crust();
    const res = crust.carve(dir, radiusRad, depthVox, seed);
    const changed = new Set(res.changed);
    const maskR = carveMaskRadius(radiusRad);
    let checked = 0;
    for (let face = 0 as FaceId; face < 6; face++) {
      for (let y = 0; y < CRUST_FACE_N; y++) {
        for (let x = 0; x < CRUST_FACE_N; x++) {
          const colDir = crust.columnDir(face, x, y);
          const ang = Math.acos(Math.min(1, Math.max(-1, dot(colDir, dir))));
          if (ang > maskR) continue;
          checked++;
          const cx = Math.floor(x / CRUST_CHUNK);
          const cy = Math.floor(y / CRUST_CHUNK);
          const key = crust.chunkKey(face, cx, cy);
          expect(changed.has(key)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }

  it('инвариант: каждый столбец под диском маски дырок лежит над задетым (changed) чанком', () => {
    assertMaskCoveredByChangedChunks(SAHARA, 0.046, 5, 42);
  });

  it('инвариант держится и для мелкого 1Мт-удара (проверяет фикс cosLim)', () => {
    assertMaskCoveredByChangedChunks(SAHARA, 0.009, 1.5, 7);
  });

  // Полюс внутри диска маски (но НЕ ровно в полюсе — южная Антарктида, 2° от полюса):
  // HoleMask.markCarve красит не диск, а сферическую шапку радиусом angToPole+maskR вокруг
  // полюса (см. ревью Task 11, band-ветка в markCarve). Проверяем именно форму шапки —
  // каждый столбец в её пределах (а не только в пределах обычного диска вокруг dir) обязан
  // лежать над changed-чанком.
  it('инвариант держится у полюса: шапка маски (band) покрыта changed-чанками, не только диск вокруг dir', () => {
    const crust = new Crust();
    const dir = lonLatToDir(0, deg(-88)); // 2° от южного полюса, не ровно в полюс
    const radiusRad = 0.046;
    const res = crust.carve(dir, radiusRad, 5, 42);
    const changed = new Set(res.changed);
    const maskR = carveMaskRadius(radiusRad);
    const capR = deg(2) + maskR; // angToPole(dir) + maskR — точная форма band'а HoleMask
    let checked = 0;
    for (let face = 0 as FaceId; face < 6; face++) {
      for (let y = 0; y < CRUST_FACE_N; y++) {
        for (let x = 0; x < CRUST_FACE_N; x++) {
          const colDir = crust.columnDir(face, x, y);
          const angToSouthPole = Math.acos(Math.min(1, Math.max(-1, -colDir.y)));
          if (angToSouthPole > capR) continue;
          checked++;
          const cx = Math.floor(x / CRUST_CHUNK);
          const cy = Math.floor(y / CRUST_CHUNK);
          const key = crust.chunkKey(face, cx, cy);
          expect(changed.has(key)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('removedByMat раскладывает выбитое по материалам и суммируется в removed', () => {
    const crust = new Crust();
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    const { soil, rock, basalt } = res.removedByMat;
    expect(soil + rock + basalt).toBe(res.removed);
    // глубокий удар (5 слоёв) задевает и грунт (слои 0-1), и породу (2-4)
    expect(soil).toBeGreaterThan(0);
    expect(rock).toBeGreaterThan(0);
    // детерминизм разбивки
    const again = new Crust().carve(SAHARA, 0.046, 5, 42);
    expect(again.removedByMat).toEqual(res.removedByMat);
  });

  it('removedByMat нулевой при ударе по океану', () => {
    const res = new Crust().carve(PACIFIC, 0.046, 5, 42);
    expect(res.removedByMat).toEqual({ soil: 0, rock: 0, basalt: 0 });
  });

  it('deepestLayer: глубокий удар достаёт базальт, мелкий — нет, океан — −1', () => {
    expect(new Crust().carve(SAHARA, 0.046, 5, 42).deepestLayer).toBeGreaterThanOrEqual(5);
    const shallow = new Crust().carve(SAHARA, 0.009, 1, 42).deepestLayer;
    expect(shallow).toBeGreaterThanOrEqual(0);
    expect(shallow).toBeLessThan(5);
    expect(new Crust().carve(PACIFIC, 0.046, 5, 42).deepestLayer).toBe(-1);
  });

  it('integrity: 1 у свежей коры, падает ровно на removed/бюджет, reset возвращает 1', () => {
    const crust = new Crust();
    expect(crust.integrity()).toBe(1);
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    expect(crust.integrity()).toBeCloseTo(1 - res.removed / CRUST_DOOM_VOXELS, 10);
    crust.reset();
    expect(crust.integrity()).toBe(1);
  });

  it('crackStrengthForDepth: 0 до базальта, растёт с глубиной до 1', () => {
    expect(crackStrengthForDepth(-1)).toBe(0);
    expect(crackStrengthForDepth(4)).toBe(0);
    expect(crackStrengthForDepth(5)).toBeCloseTo(1 / 3, 10);
    expect(crackStrengthForDepth(7)).toBe(1);
    expect(crackStrengthForDepth(99)).toBe(1);
  });
});
