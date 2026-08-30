import type * as THREE from 'three/webgpu';
import { createThreeCtx, detectBackend, type ThreeCtx } from './backend/createThreeRenderer';

export type { ThreeCtx };

// Что рисовать вместо основной сцены: режим плоской карты подменяет и сцену, и камеру,
// чтобы глобус со всеми его эффектами остался нетронутым (спека 2026-08-29-flat-map §4).
export interface ViewOverride {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export interface Renderer {
  init(): Promise<void>;
  render(dt: number): void;
  resize(w: number, h: number): void;
  setViewOverride(view: ViewOverride | undefined): void;
  dispose(): void;
  readonly backend: 'webgpu' | 'webgl2';
  readonly ctx: ThreeCtx;
}

class ThreeRenderer implements Renderer {
  private _ctx!: ThreeCtx;
  private _backend: 'webgpu' | 'webgl2' = 'webgl2';
  private _override: ViewOverride | undefined;
  constructor(private canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    this._ctx = await createThreeCtx(this.canvas);
    this._backend = detectBackend(this._ctx.renderer);
    this.resize(window.innerWidth, window.innerHeight);
  }
  render(): void {
    const view = this._override;
    if (view) this._ctx.renderer.render(view.scene, view.camera);
    else this._ctx.renderer.render(this._ctx.scene, this._ctx.camera);
  }
  setViewOverride(view: ViewOverride | undefined): void {
    this._override = view;
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
