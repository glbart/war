// Геометрия киношного разрыва планеты (ревизия спеки 2026-07-14 §5). ЧИСТЫЙ TS (без three):
// сферическая оболочка (внешний радиус 1, внутренний SHATTER_SHELL_INNER) разбивается
// Вороным по сфере на SHATTER_PLATE_COUNT замкнутых кусков. Каждый кусок — внешняя корка +
// внутренняя изнанка + стенки по границам региона: вместе куски составляют ровно исходную
// сферу (бесшовная подмена глобуса в момент раскола), а замкнутость каждого куска даёт
// честные рваные срезы при разлёте. Детерминизм — LCG от seed.
import type { Vec3 } from '../sim/geo';
import { SHATTER_PLATE_COUNT, SHATTER_SHELL_INNER } from '../assets/config';

// Подразбиений икосаэдра: 20·4³ = 1280 треугольников — куски достаточно рваные по краям,
// но буферы лёгкие (тест замкнутости считает рёбра по всем кускам).
export const ICO_DETAIL = 3;

export interface ShardData {
  positions: Float32Array; // неиндексированные треугольники (корка + изнанка + стенки)
  center: Vec3; // единичное направление центра куска (ось разлёта)
  outerTriCount: number; // сколько треугольников внешней корки (для тестов сохранения сферы)
}

// Икосфера: индексированные вершины на единичной сфере + треугольники (CCW наружу).
function buildIcosphere(): { verts: Vec3[]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  const verts: Vec3[] = raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return { x: x / l, y: y / l, z: z / l };
  });
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let s = 0; s < ICO_DETAIL; s++) {
    const midCache = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const va = verts[a]!;
      const vb = verts[b]!;
      const mx = va.x + vb.x;
      const my = va.y + vb.y;
      const mz = va.z + vb.z;
      const l = Math.hypot(mx, my, mz);
      const idx = verts.length;
      verts.push({ x: mx / l, y: my / l, z: mz / l });
      midCache.set(key, idx);
      return idx;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { verts, faces };
}

// Разбивает оболочку на замкнутые куски. Пустые регионы Вороного отбрасываются
// (кусков может быть меньше SHATTER_PLATE_COUNT).
export function buildShardData(seed: number): ShardData[] {
  const { verts, faces } = buildIcosphere();

  let s = seed | 0 || 1;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  const seeds: Vec3[] = [];
  for (let i = 0; i < SHATTER_PLATE_COUNT; i++) {
    const az = rnd() * Math.PI * 2;
    const cz = rnd() * 2 - 1;
    const sxy = Math.sqrt(Math.max(0, 1 - cz * cz));
    seeds.push({ x: sxy * Math.cos(az), y: sxy * Math.sin(az), z: cz });
  }

  // Регион каждого треугольника — ближайший seed к центроиду (max dot).
  const regionOf = faces.map(([a, b, c]) => {
    const va = verts[a]!;
    const vb = verts[b]!;
    const vc = verts[c]!;
    const cx = va.x + vb.x + vc.x;
    const cy = va.y + vb.y + vc.y;
    const cz = va.z + vb.z + vc.z;
    let best = 0;
    let bestDot = -Infinity;
    for (let k = 0; k < seeds.length; k++) {
      const sd = seeds[k]!;
      const d = cx * sd.x + cy * sd.y + cz * sd.z;
      if (d > bestDot) {
        bestDot = d;
        best = k;
      }
    }
    return best;
  });

  const RIN = SHATTER_SHELL_INNER;
  const shards: ShardData[] = [];

  for (let k = 0; k < seeds.length; k++) {
    const regionFaces = faces.filter((_, i) => regionOf[i] === k);
    if (regionFaces.length === 0) continue;

    // Направленные рёбра региона: граница — рёбра без обратного (сосед в другом регионе).
    const directed = new Set<string>();
    for (const [a, b, c] of regionFaces) {
      directed.add(`${a}:${b}`);
      directed.add(`${b}:${c}`);
      directed.add(`${c}:${a}`);
    }
    const boundary: [number, number][] = [];
    for (const [a, b, c] of regionFaces) {
      const edges: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (const [u, v] of edges) if (!directed.has(`${v}:${u}`)) boundary.push([u, v]);
    }

    // Буфер: корка + изнанка (обратная намотка) + стенки (2 треугольника на граничное ребро).
    const triCount = regionFaces.length * 2 + boundary.length * 2;
    const positions = new Float32Array(triCount * 9);
    let o = 0;
    const put = (v: Vec3, r: number): void => {
      positions[o++] = v.x * r;
      positions[o++] = v.y * r;
      positions[o++] = v.z * r;
    };
    for (const [a, b, c] of regionFaces) {
      put(verts[a]!, 1);
      put(verts[b]!, 1);
      put(verts[c]!, 1);
    }
    for (const [a, b, c] of regionFaces) {
      put(verts[c]!, RIN);
      put(verts[b]!, RIN);
      put(verts[a]!, RIN);
    }
    for (const [u, v] of boundary) {
      // Квад стенки между внешними (r=1) и внутренними (r=RIN) вершинами ребра.
      put(verts[v]!, 1);
      put(verts[u]!, 1);
      put(verts[u]!, RIN);
      put(verts[v]!, 1);
      put(verts[u]!, RIN);
      put(verts[v]!, RIN);
    }

    // Центр куска — нормированная сумма центроидов его треугольников (ось разлёта).
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const [a, b, c] of regionFaces) {
      cx += verts[a]!.x + verts[b]!.x + verts[c]!.x;
      cy += verts[a]!.y + verts[b]!.y + verts[c]!.y;
      cz += verts[a]!.z + verts[b]!.z + verts[c]!.z;
    }
    const cl = Math.hypot(cx, cy, cz) || 1;
    shards.push({
      positions,
      center: { x: cx / cl, y: cy / cl, z: cz / cl },
      outerTriCount: regionFaces.length,
    });
  }

  return shards;
}
