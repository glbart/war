// Камера: зум, инерция вращения, автоповорот при простое.
// Порт логики из reference/earth-nuke.html — pointermove (~962-974) и animate() (~1058-1084).
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from '../render/Renderer';
import type { GlobeView } from '../render/GlobeView';

export const ZOOM_MIN = 1.05;
export const ZOOM_MAX = 7;
const DEFAULT_ZOOM = 3.2;

const TILT_LIMIT = 1.45; // clamp наклона по X, радианы
const INERTIA_DAMPING = 0.93; // затухание скорости вращения за кадр
const IDLE_AUTOROTATE_DELAY = 3; // секунд простоя до автоповорота
const AUTOROTATE_SPEED = 0.04; // рад/с
const AUTOROTATE_MIN_ZOOM = 2; // автоповорот только на дальнем зуме
const DRAG_ROTATE_SPEED = 0.0045;

export class CameraRig {
  zoom = DEFAULT_ZOOM;

  private velX = 0;
  private velY = 0;
  private idleTime = 0;

  constructor(
    private readonly ctx: ThreeCtx,
    private readonly globe: GlobeView,
  ) {}

  // Крутит глобус на dx/dy пикселей драга; скорость падает с приближением камеры
  // (как на картах) и запоминается как скорость инерции на момент отпускания.
  rotateBy(dx: number, dy: number): void {
    const { MathUtils } = this.ctx.THREE;
    const speed = DRAG_ROTATE_SPEED * MathUtils.clamp((this.zoom - 1) / 2.2, 0.02, 1);
    this.globe.spinGroup.rotation.y += dx * speed;
    this.globe.tiltGroup.rotation.x = MathUtils.clamp(
      this.globe.tiltGroup.rotation.x + dy * speed,
      -TILT_LIMIT,
      TILT_LIMIT,
    );
    this.velX = dx * speed;
    this.velY = dy * speed;
    this.idleTime = 0;
  }

  // Вызывается каждый кадр рендера. Пока кнопка не зажата — инерция и автоповорот;
  // затем камера ставится на дистанцию zoom вдоль +Z (тряску добавим в Task 8).
  update(dt: number, pointerDown: boolean): void {
    const { MathUtils } = this.ctx.THREE;

    if (!pointerDown) {
      this.globe.spinGroup.rotation.y += this.velX;
      this.globe.tiltGroup.rotation.x = MathUtils.clamp(
        this.globe.tiltGroup.rotation.x + this.velY,
        -TILT_LIMIT,
        TILT_LIMIT,
      );
      this.velX *= INERTIA_DAMPING;
      this.velY *= INERTIA_DAMPING;
      this.idleTime += dt;
      if (this.idleTime > IDLE_AUTOROTATE_DELAY && this.zoom > AUTOROTATE_MIN_ZOOM) {
        this.globe.spinGroup.rotation.y += dt * AUTOROTATE_SPEED;
      }
    }

    this.applyCamera();
  }

  private applyCamera(): void {
    const camera: THREE.PerspectiveCamera = this.ctx.camera;
    camera.position.set(0, 0, this.zoom);
    camera.lookAt(0, 0, 0);
  }
}
