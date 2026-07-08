import { describe, it, expect } from 'vitest';
import { faceUVToDir, dirToFaceUV, type FaceId } from '../../src/crust/cubesphere';

describe('cubesphere', () => {
  it('roundtrip dir → faceUV → dir для сетки направлений', () => {
    for (let i = 0; i < 200; i++) {
      // детерминированная сетка направлений (без Math.random — воспроизводимость)
      const t = i / 200;
      const lon = t * Math.PI * 2 - Math.PI;
      const lat = Math.sin(i * 12.9898) * 1.4; // псевдослучайные широты в (−1.4..1.4) рад
      const d = {
        x: Math.cos(lat) * Math.cos(lon),
        y: Math.sin(lat),
        z: -Math.cos(lat) * Math.sin(lon),
      };
      const { face, u, v } = dirToFaceUV(d);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const back = faceUVToDir(face, u, v);
      expect(back.x).toBeCloseTo(d.x, 6);
      expect(back.y).toBeCloseTo(d.y, 6);
      expect(back.z).toBeCloseTo(d.z, 6);
    }
  });

  it('центры граней смотрят вдоль осей', () => {
    expect(faceUVToDir(0, 0.5, 0.5).x).toBeCloseTo(1, 9); // +X
    expect(faceUVToDir(2, 0.5, 0.5).y).toBeCloseTo(1, 9); // +Y (север)
    expect(faceUVToDir(5, 0.5, 0.5).z).toBeCloseTo(-1, 9); // −Z
  });

  it('экстраполяция за грань (u<0) даёт единичный вектор', () => {
    const d = faceUVToDir(0 as FaceId, -0.01, 0.5);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
  });
});
