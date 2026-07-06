import { describe, it, expect } from 'vitest';
import { surfaceNets } from '../../src/crust/surfaceNets';

const always = () => true;

describe('surfaceNets', () => {
  it('сплошная плита даёт замкнутую поверхность (вершины и треугольники есть)', () => {
    // плита 4×4×2 в решётке 4×4×4 (нижние 2 слоя твёрдые)
    const solid = (x: number, y: number, d: number) =>
      x >= 0 && y >= 0 && x < 4 && y < 4 && d >= 2 && d < 4;
    const r = surfaceNets(solid, () => 1, 4, 4, 4, always);
    expect(r.verts.length / 3).toBeGreaterThan(0);
    expect(r.tris.length % 3).toBe(0);
    // все индексы валидны
    const nVerts = r.verts.length / 3;
    for (const i of r.tris) expect(i).toBeLessThan(nVerts);
    expect(r.vmat.length).toBe(nVerts);
  });

  it('пустое поле → пустой меш', () => {
    const r = surfaceNets(
      () => false,
      () => 0,
      4,
      4,
      4,
      always,
    );
    expect(r.verts.length).toBe(0);
    expect(r.tris.length).toBe(0);
  });

  it('полное поле (без границ в диапазоне сэмплов) → грани только на краях диапазона', () => {
    const solid = (x: number, y: number, d: number) =>
      x >= 0 && y >= 0 && d >= 0 && x < 4 && y < 4 && d < 4;
    const r = surfaceNets(solid, () => 1, 4, 4, 4, always);
    expect(r.tris.length).toBeGreaterThan(0); // крышка+стенки+дно куба 4×4×4
  });

  it('ownQuad фильтрует квады по боковой координате ребра', () => {
    const solid = (x: number, y: number, d: number) =>
      x >= 0 && y >= 0 && d >= 0 && x < 4 && y < 4 && d < 4;
    const all = surfaceNets(solid, () => 1, 4, 4, 4, always);
    const none = surfaceNets(
      solid,
      () => 1,
      4,
      4,
      4,
      () => false,
    );
    expect(none.tris.length).toBe(0);
    expect(all.tris.length).toBeGreaterThan(0);
  });
});
