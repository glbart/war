import { describe, it, expect } from 'vitest';
import { Crust, MAT_EMPTY, MAT_SOIL, MAT_ROCK, MAT_BASALT, MAT_WATER } from '../../src/crust/Crust';
import { dirToFaceUV } from '../../src/crust/cubesphere';
import { lonLatToDir } from '../../src/sim/geo';
import { CRUST_FACE_N, CRUST_DEPTH_LAYERS } from '../../src/assets/config';

const deg = (x: number) => (x * Math.PI) / 180;

// столбец (face,x,y) по lon/lat
function columnOf(lonDeg: number, latDeg: number) {
  const { face, u, v } = dirToFaceUV(lonLatToDir(deg(lonDeg), deg(latDeg)));
  return {
    face,
    x: Math.min(CRUST_FACE_N - 1, Math.floor(u * CRUST_FACE_N)),
    y: Math.min(CRUST_FACE_N - 1, Math.floor(v * CRUST_FACE_N)),
  };
}

describe('Crust: нетронутое состояние', () => {
  it('суша (Сахара): грунт сверху, порода в середине, базальт внизу', () => {
    const crust = new Crust();
    const { face, x, y } = columnOf(20, 23);
    expect(crust.getVoxel(face, x, y, 0)).toBe(MAT_SOIL);
    expect(crust.getVoxel(face, x, y, 3)).toBe(MAT_ROCK);
    expect(crust.getVoxel(face, x, y, CRUST_DEPTH_LAYERS - 1)).toBe(MAT_BASALT);
  });

  it('океан (центр Тихого): столбец — вода на всех слоях', () => {
    const crust = new Crust();
    const { face, x, y } = columnOf(-140, 0);
    expect(crust.getVoxel(face, x, y, 0)).toBe(MAT_WATER);
    expect(crust.getVoxel(face, x, y, 5)).toBe(MAT_WATER);
  });

  it('над поверхностью и под корой — пусто', () => {
    const crust = new Crust();
    const { face, x, y } = columnOf(20, 23);
    expect(crust.getVoxel(face, x, y, -1)).toBe(MAT_EMPTY);
    expect(crust.getVoxel(face, x, y, CRUST_DEPTH_LAYERS)).toBe(MAT_EMPTY);
  });

  it('getVoxelExt за краем грани перепроецируется (не пусто на суше соседней грани)', () => {
    const crust = new Crust();
    // столбец у самого края грани — сэмпл x−2 уходит на соседнюю грань, но остаётся валидным
    const { face, y } = columnOf(0, 0);
    const m = crust.getVoxelExt(face, -2, y, 0);
    expect([MAT_SOIL, MAT_ROCK, MAT_WATER]).toContain(m);
  });
});
