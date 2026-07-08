// Наивные Surface Nets по бинарному полю занятости. Сэмплы — воксели (целые узлы решётки);
// ячейка — куб из 2×2×2 соседних сэмплов. В каждой смешанной ячейке ставится одна вершина
// (среднее середин рёбер со сменой знака — «стянутый кубик», скошенные края без лего-ступенек);
// на каждом ребре решётки со сменой знака — квад из вершин 4 прилегающих ячеек.
// Диапазон сэмплов: x,y ∈ [−1..nx], d ∈ [−1..nd] — margin в один воксель со всех сторон,
// чтобы грани на границе чанка совпали с соседними чанками (те считают из тех же сэмплов).
// ownQuad(xEdge, yEdge) — дедуп между чанками: квад эмитится только «владельцем» ребра.
export interface NetsResult {
  verts: number[]; // тройки (x,y,d) в непрерывных координатах решётки
  tris: number[]; // индексы (тройки)
  vmat: number[]; // материал вершины
}

export function surfaceNets(
  solidAt: (x: number, y: number, d: number) => boolean,
  matAt: (x: number, y: number, d: number) => number,
  nx: number,
  ny: number,
  nd: number,
  ownQuad: (xEdgeLow: number, yEdgeLow: number) => boolean,
): NetsResult {
  // кэш занятости: индексы со сдвигом +1 (x ∈ [−1..nx] → [0..nx+1])
  const sx = nx + 2;
  const sy = ny + 2;
  const sd = nd + 2;
  const occ = new Uint8Array(sx * sy * sd);
  const oi = (x: number, y: number, d: number) => ((y + 1) * sx + (x + 1)) * sd + (d + 1);
  for (let y = -1; y <= ny; y++)
    for (let x = -1; x <= nx; x++)
      for (let d = -1; d <= nd; d++) occ[oi(x, y, d)] = solidAt(x, y, d) ? 1 : 0;

  // вершины: по одной на смешанную ячейку; ячейка (x,y,d) — куб сэмплов (x..x+1, y..y+1, d..d+1)
  const cellVert = new Int32Array(sx * sy * sd).fill(-1);
  const verts: number[] = [];
  const vmat: number[] = [];
  const CORNERS: Array<[number, number, number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  // 12 рёбер куба как пары индексов углов
  const EDGES: Array<[number, number]> = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7], // вдоль X
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7], // вдоль Y
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7], // вдоль D
  ];
  for (let y = -1; y < ny; y++)
    for (let x = -1; x < nx; x++)
      for (let d = -1; d < nd; d++) {
        let mask = 0;
        for (let ci = 0; ci < 8; ci++) {
          const [dx, dy, dd] = CORNERS[ci]!;
          if (occ[oi(x + dx, y + dy, d + dd)]) mask |= 1 << ci;
        }
        if (mask === 0 || mask === 0xff) continue;
        // вершина = ячейкин центр масс середин рёбер со сменой знака
        let px = 0;
        let py = 0;
        let pd = 0;
        let cnt = 0;
        for (const [a, b] of EDGES) {
          const sa = (mask >> a) & 1;
          const sb = (mask >> b) & 1;
          if (sa === sb) continue;
          const [ax, ay, ad] = CORNERS[a]!;
          const [bx, by, bd] = CORNERS[b]!;
          px += (ax + bx) / 2;
          py += (ay + by) / 2;
          pd += (ad + bd) / 2;
          cnt++;
        }
        cellVert[oi(x, y, d)] = verts.length / 3;
        verts.push(x + px / cnt, y + py / cnt, d + pd / cnt);
        // материал вершины: самый «верхний» (min d) твёрдый угол ячейки
        let best = 0;
        let bestD = Infinity;
        for (let ci = 0; ci < 8; ci++) {
          if (!((mask >> ci) & 1)) continue;
          const [dx, dy, dd] = CORNERS[ci]!;
          if (d + dd < bestD) {
            bestD = d + dd;
            best = matAt(x + dx, y + dy, d + dd);
          }
        }
        vmat.push(best);
      }

  // Безопасный доступ к вершине ячейки: координаты ячейки вне [−1..n−1] по любой оси —
  // ячейка не существует (а не «соседняя строка» — прямое чтение cellVert[oi(...)] на x=−2
  // и т.п. давало алиасинг на чужую ячейку из-за сдвига +1 в oi, т.к. паддинг массива
  // рассчитан только на один запасной слой снизу). Возвращаем −1 («нет вершины»).
  const cellAt = (x: number, y: number, d: number): number => {
    if (x < -1 || x >= nx || y < -1 || y >= ny || d < -1 || d >= nd) return -1;
    return cellVert[oi(x, y, d)]!;
  };

  // квады: для каждого ребра решётки со сменой знака — 4 прилегающие ячейки
  const tris: number[] = [];
  const AX: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let axis = 0; axis < 3; axis++) {
    const [ux, uy, ud] = AX[axis]!;
    // две другие оси — для обхода прилегающих ячеек
    const [vx, vy, vd] = AX[(axis + 1) % 3]!;
    const [wx, wy, wd] = AX[(axis + 2) % 3]!;
    for (let y = -1; y <= ny; y++)
      for (let x = -1; x <= nx; x++)
        for (let d = -1; d <= nd; d++) {
          const x2 = x + ux;
          const y2 = y + uy;
          const d2 = d + ud;
          if (x2 > nx || y2 > ny || d2 > nd) continue;
          const s0 = occ[oi(x, y, d)]!;
          const s1 = occ[oi(x2, y2, d2)]!;
          if (s0 === s1) continue;
          if (!ownQuad(Math.min(x, x2), Math.min(y, y2))) continue;
          // 4 ячейки вокруг ребра: (p−v−w, p−v, p−w, p), p = min-угол ребра
          const c00 = cellAt(x - vx - wx, y - vy - wy, d - vd - wd);
          const c01 = cellAt(x - vx, y - vy, d - vd);
          const c10 = cellAt(x - wx, y - wy, d - wd);
          const c11 = cellAt(x, y, d);
          if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;
          if (s0) tris.push(c00, c10, c11, c00, c11, c01);
          else tris.push(c00, c01, c11, c00, c11, c10);
        }
  }
  return { verts, tris, vmat };
}
