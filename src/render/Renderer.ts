import { createThreeCtx, detectBackend, type ThreeCtx } from './backend/createThreeRenderer';

export type { ThreeCtx };

export interface Renderer {
  init(): Promise<void>;
  render(dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
  readonly backend: 'webgpu' | 'webgl2';
  readonly ctx: ThreeCtx;
}

class ThreeRenderer implements Renderer {
  private _ctx!: ThreeCtx;
  private _backend: 'webgpu' | 'webgl2' = 'webgl2';
  constructor(private canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    this._ctx = await createThreeCtx(this.canvas);
    this._backend = detectBackend(this._ctx.renderer);
    this.resize(window.innerWidth, window.innerHeight);
  }
  render(): void {
    this._ctx.renderer.render(this._ctx.scene, this._ctx.camera);
  }
  resize(w: number, h: number): void {
    this._ctx.renderer.setSize(w, h);
    this._ctx.camera.aspect = w / h;
    this._ctx.camera.updateProjectionMatrix();
  }
  dispose(): void {
    this._ctx.renderer.dispose();
  }
  get backend() {
    return this._backend;
  }
  get ctx() {
    return this._ctx;
  }
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  return new ThreeRenderer(canvas);
}
