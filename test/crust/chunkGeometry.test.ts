import { describe, it, expect } from 'vitest';
import { Crust } from '../../src/crust/Crust';
import { buildChunkGeo } from '../../src/crust/chunkGeometry';
import { dirToFaceUV } from '../../src/crust/cubesphere';
import { lonLatToDir } from '../../src/sim/geo';
import { CRUST_FACE_N, CRUST_CHUNK } from '../../src/assets/config';

const deg = (x: number) => (x * Math.PI) / 180;
const SAHARA = lonLatToDir(deg(20), deg(23));

describe('buildChunkGeo', () => {
  it('после carve чанк эпицентра даёт непустой меш с валидными данными', () => {
    const crust = new Crust();
    const res = crust.carve(SAHARA, 0.046, 5, 42);
    expect(res.changed.length).toBeGreaterThan(0);
    const { face, u, v } = dirToFaceUV(SAHARA);
    const cx = Math.floor((u * CRUST_FACE_N) / CRUST_CHUNK);
    const cy = Math.floor((v * CRUST_FACE_N) / CRUST_CHUNK);
    const geo = buildChunkGeo(crust, face, cx, cy);
    expect(geo).not.toBeNull();
    const g = geo!;
    expect(g.positions.length % 3).toBe(0);
    expect(g.indices.length % 3).toBe(0);
    // радиусы вершин в разумном диапазоне: [дно коры − ε .. потолок крышки (1−LID_DROP) + ε]
    const LID_DROP = 0.0005;
    for (let i = 0; i < g.positions.length; i += 3) {
      const r = Math.hypot(g.positions[i]!, g.positions[i + 1]!, g.positions[i + 2]!);
      expect(r).toBeGreaterThan(0.9);
      expect(r).toBeLessThanOrEqual(1.0 - LID_DROP + 1e-6);
    }
    // uv в [0,1]
    for (const t of g.uvs) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    expect(g.mats.length).toBe(g.positions.length / 3);
  });

  it('нетронутая поверхность чанка лежит на волосок под сферой r=1−LID_DROP (крышка)', () => {
    const crust = new Crust();
    crust.carve(SAHARA, 0.02, 2, 42); // маленький удар — большая часть чанка нетронута
    const { face, u, v } = dirToFaceUV(SAHARA);
    const cx = Math.floor((u * CRUST_FACE_N) / CRUST_CHUNK);
    const cy = Math.floor((v * CRUST_FACE_N) / CRUST_CHUNK);
    const g = buildChunkGeo(crust, face, cx, cy)!;
    const LID_DROP = 0.0005;
    let atLid = 0;
    for (let i = 0; i < g.positions.length; i += 3) {
      const r = Math.hypot(g.positions[i]!, g.positions[i + 1]!, g.positions[i + 2]!);
      if (Math.abs(r - (1 - LID_DROP)) < 1e-6) atLid++;
    }
    expect(atLid).toBeGreaterThan(10); // крышка нетронутой части прижата к потолку 1−LID_DROP
  });
});
