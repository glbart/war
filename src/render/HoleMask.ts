// Equirect-маска «дырок» глобуса: белое = регион, где глобус discard'ится (его заменяет
// воксельный чанк CrustView). Канва в конвенции биом-текстуры (строка 0 = север) +
// flipY=true (по умолчанию CanvasTexture) → сэмпл uv() на сфере совпадает.
//
// Маска красится ПО ДИСКУ реального карва (markCarve), а не по AABB чанка: чанк — это лишь
// unit ремеша, его прямоугольный след на грани cube-sphere не имеет отношения к форме дыры,
// которую видно на глобусе. Красить прямоугольник чанка означало discard'ить намного больше
// сферы, чем реально выгрызено — получалась прямоугольная проплешина со straight edges вокруг
// круглого кратера (см. ревью Task 11).
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { dirToLonLat } from '../sim/geo';
import { carveMaskRadius } from '../crust/Crust';

const MASK_W = 1024;
const MASK_H = 512;
const DISK_SEGS = 24; // точек по окружности диска — сглаженный круг на equirect-канве

function crossV(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalizeV(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export class HoleMask {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx2d: CanvasRenderingContext2D;

  constructor(ctx: ThreeCtx) {
    const { THREE } = ctx;
    const canvas = document.createElement('canvas');
    canvas.width = MASK_W;
    canvas.height = MASK_H;
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error('HoleMask: 2d-контекст недоступен');
    this.ctx2d = c2d;
    this.clearCanvas();
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.wrapS = THREE.RepeatWrapping;
  }

  private clearCanvas(): void {
    this.ctx2d.fillStyle = '#000';
    this.ctx2d.fillRect(0, 0, MASK_W, MASK_H);
  }

  // Закрашивает диск на equirect-маске вокруг направления удара dir. radiusRad — боковой
  // радиус карва (тот же, что уходит в Crust.carve). Запас ×1.25 покрывает джиттер рваного
  // края эллипсоида (Crust.jitter, реальный максимум t ≤ √1.15 ≈ ×1.073), +1.5 вокселя —
  // полувоксельное сглаживание границы Surface Nets по обе стороны шва чанков.
  // Формула — carveMaskRadius в Crust.ts, ОДНА на маску и на пометку чанков в carve(): каждый
  // закрашенный пиксель маски гарантированно лежит над чанком с мешем.
  markCarve(dir: Vec3, radiusRad: number): void {
    const r = carveMaskRadius(radiusRad);

    // Ортобазис к dir — точки окружности диска строятся как наклон dir на угол r в случайном
    // направлении (t1,t2) касательной плоскости.
    const up: Vec3 = Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const t1 = normalizeV(crossV(dir, up));
    const t2 = crossV(dir, t1); // уже единичный: dir⊥t1, оба единичные

    const cosR = Math.cos(r);
    const sinR = Math.sin(r);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < DISK_SEGS; i++) {
      const a = (i / DISK_SEGS) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p: Vec3 = {
        x: dir.x * cosR + (t1.x * ca + t2.x * sa) * sinR,
        y: dir.y * cosR + (t1.y * ca + t2.y * sa) * sinR,
        z: dir.z * cosR + (t1.z * ca + t2.z * sa) * sinR,
      };
      const { lon, lat } = dirToLonLat(p);
      xs.push((lon + Math.PI) / (2 * Math.PI));
      ys.push((Math.PI / 2 - lat) / Math.PI);
    }

    this.ctx2d.fillStyle = '#fff';

    // Полюс внутри диска — equirect-полигон вырождается, красим полосу на всю ширину канвы
    // (аналогично прежнему poleBand у чанков): север — от y=0 до нижней границы диска,
    // юг — от верхней границы диска до y=1.
    const angToNorth = Math.acos(Math.min(1, Math.max(-1, dir.y)));
    if (angToNorth < r) {
      const yMax = Math.max(...ys) * MASK_H;
      this.ctx2d.fillRect(0, 0, MASK_W, yMax);
      this.texture.needsUpdate = true;
      return;
    }
    const angToSouth = Math.PI - angToNorth;
    if (angToSouth < r) {
      const yMin = Math.min(...ys) * MASK_H;
      this.ctx2d.fillRect(0, yMin, MASK_W, MASK_H - yMin);
      this.texture.needsUpdate = true;
      return;
    }

    // Шов долготы: если диск пересекает ±π, точки разъезжаются на разные концы канвы —
    // приводим к одной стороне и рисуем дважды со сдвигом −1 (как в equirect-развёртке биома).
    const wrap = Math.max(...xs) - Math.min(...xs) > 0.5;
    const draw = (shiftX: number) => {
      this.ctx2d.beginPath();
      for (let i = 0; i < xs.length; i++) {
        let x = xs[i]!;
        if (wrap && x < 0.5) x += 1;
        const px = (x + shiftX) * MASK_W;
        const py = ys[i]! * MASK_H;
        if (i === 0) this.ctx2d.moveTo(px, py);
        else this.ctx2d.lineTo(px, py);
      }
      this.ctx2d.closePath();
      this.ctx2d.fill();
    };
    draw(0);
    if (wrap) draw(-1);
    this.texture.needsUpdate = true;
  }

  clear(): void {
    this.clearCanvas();
    this.texture.needsUpdate = true;
  }
}
