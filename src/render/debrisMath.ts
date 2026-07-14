// Чистая математика обломков-глыб (без three.js) — CPU-зеркала TSL-веток DebrisView и
// вспомогательная логика emit. Вынесена отдельно, чтобы тестироваться headless (vitest).
import type { Vec3 } from '../sim/geo';
import { DEBRIS_PER_VOXEL, DEBRIS_MIN, DEBRIS_MAX } from '../assets/config';

function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// Касательный базис из нормали — ТОТ ЖЕ алгоритм, что TSL-граф EjectaView/DebrisView
// (t1 = |n.y|<0.99 ? normalize(cross(n, up)) : (1,0,0)); менять только синхронно с шейдером.
export function orthoBasis(n: Vec3): { t1: Vec3; t2: Vec3 } {
  const t1 = Math.abs(n.y) < 0.99 ? norm3(cross3(n, { x: 0, y: 1, z: 0 })) : { x: 1, y: 0, z: 0 };
  const t2 = norm3(cross3(n, t1));
  return { t1, t2 };
}

// smoothstep(0,1,x) с клампом — как в TSL.
function smooth01(x: number): number {
  const s = Math.min(1, Math.max(0, x));
  return s * s * (3 - 2 * s);
}

// Орбитальная ветка: спиральный взлёт с поверхности (r=1) на орбиту r=orbitR за ascentT сек,
// далее вечное кружение в плоскости (n, e2), e2 = t1·cos(angle) + t2·sin(angle).
// При tau=0 позиция = n (точка запуска). CPU-зеркало орбитальной ветки TSL DebrisView.
export function orbitalPos(
  n: Vec3,
  angle: number,
  omega: number,
  orbitR: number,
  ascentT: number,
  tau: number,
): Vec3 {
  const { t1, t2 } = orthoBasis(n);
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  const e2: Vec3 = {
    x: t1.x * ca + t2.x * sa,
    y: t1.y * ca + t2.y * sa,
    z: t1.z * ca + t2.z * sa,
  };
  const theta = omega * tau;
  const r = 1 + (orbitR - 1) * smooth01(tau / ascentT);
  const ct = Math.cos(theta),
    st = Math.sin(theta);
  return {
    x: (n.x * ct + e2.x * st) * r,
    y: (n.y * ct + e2.y * st) * r,
    z: (n.z * ct + e2.z * st) * r,
  };
}

// Направление точки приземления баллистической глыбы: эпицентр n, снос по касательной
// под азимутом angle на дугу dist (единицы радиуса ≈ радианы при малых dist).
export function landingDir(n: Vec3, angle: number, dist: number): Vec3 {
  const { t1, t2 } = orthoBasis(n);
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  return norm3({
    x: n.x + (t1.x * ca + t2.x * sa) * dist,
    y: n.y + (t1.y * ca + t2.y * sa) * dist,
    z: n.z + (t1.z * ca + t2.z * sa) * dist,
  });
}

// Сколько глыб породить на удар: пропорция от выбитых вокселей, кламп [MIN, MAX]; 0 → 0.
export function debrisCount(removed: number): number {
  if (removed <= 0) return 0;
  return Math.min(DEBRIS_MAX, Math.max(DEBRIS_MIN, Math.round(removed * DEBRIS_PER_VOXEL)));
}

// Выбор материала глыбы пропорционально разбивке выбитого (r01 — равномерный [0,1)).
export function pickMaterial(
  r01: number,
  byMat: { soil: number; rock: number; basalt: number },
): 'soil' | 'rock' | 'basalt' {
  const total = byMat.soil + byMat.rock + byMat.basalt;
  if (total <= 0) return 'rock';
  let t = r01 * total;
  if (t < byMat.soil) return 'soil';
  t -= byMat.soil;
  return t < byMat.rock ? 'rock' : 'basalt';
}

// Кольцевые курсоры двух сегментов одного инстанс-буфера DebrisView:
// орбитальный сегмент [0, orbitSlots) — вечные глыбы, вытесняется самая старая;
// баллистический [orbitSlots, orbitSlots+ballisticSlots) — конечная жизнь, переиспользование.
export class DebrisSlots {
  private orbit = 0;
  private ball = 0;

  constructor(
    private readonly orbitSlots: number,
    private readonly ballisticSlots: number,
  ) {}

  nextOrbital(): number {
    const i = this.orbit;
    this.orbit = (this.orbit + 1) % this.orbitSlots;
    return i;
  }

  nextBallistic(): number {
    const i = this.ball;
    this.ball = (this.ball + 1) % this.ballisticSlots;
    return this.orbitSlots + i;
  }

  reset(): void {
    this.orbit = 0;
    this.ball = 0;
  }
}
