// Equirect-маска «дырок» глобуса: белое = регион, где глобус discard'ится (его заменяет
// воксельный чанк CrustView). Канва в конвенции биом-текстуры (строка 0 = север) +
// flipY=true (по умолчанию CanvasTexture) → сэмпл uv() на сфере совпадает.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import { chunkFootprint } from '../crust/chunkFootprint';
import type { FaceId } from '../crust/cubesphere';

const MASK_W = 1024;
const MASK_H = 512;

export class HoleMask {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly marked = new Set<string>();

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

  markChunk(face: FaceId, cx: number, cy: number): void {
    const key = `${face}:${cx}:${cy}`;
    if (this.marked.has(key)) return;
    this.marked.add(key);
    const fp = chunkFootprint(face, cx, cy);
    this.ctx2d.fillStyle = '#fff';
    if (fp.poleBand) {
      // полюсный чанк — полоса на всю ширину (equirect-полигон у полюса вырождается)
      const y0 = fp.poleBand.yMin * MASK_H;
      this.ctx2d.fillRect(0, y0, MASK_W, fp.poleBand.yMax * MASK_H - y0);
      this.texture.needsUpdate = true;
      return;
    }
    const draw = (shiftX: number) => {
      this.ctx2d.beginPath();
      for (let i = 0; i < fp.xs.length; i++) {
        // при wrap — приводим все x к одной стороне шва, рисуем дважды со сдвигом
        let x = fp.xs[i]!;
        if (fp.wrap && x < 0.5) x += 1;
        const px = (x + shiftX) * MASK_W;
        const py = fp.ys[i]! * MASK_H;
        if (i === 0) this.ctx2d.moveTo(px, py);
        else this.ctx2d.lineTo(px, py);
      }
      this.ctx2d.closePath();
      this.ctx2d.fill();
    };
    draw(0);
    if (fp.wrap) draw(-1);
    this.texture.needsUpdate = true;
  }

  clear(): void {
    this.marked.clear();
    this.clearCanvas();
    this.texture.needsUpdate = true;
  }
}
