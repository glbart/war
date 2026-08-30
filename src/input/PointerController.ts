// Указатель мыши/тача: драг = вращение через CameraRig, колесо = зум, клик = raycast по глобусу.
// Порт обработчиков из reference/earth-nuke.html, строки ~947-997.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from '../render/Renderer';
import type { GlobeView } from '../render/GlobeView';
import { CameraRig, ZOOM_MIN, ZOOM_MAX } from './CameraRig';

const DRAG_THRESHOLD_PX = 5;
const WHEEL_ZOOM_SENSITIVITY = 0.0011;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class PointerController {
  // true, пока кнопка/палец удерживает канвас — читается CameraRig.update() для паузы инерции.
  isDown = false;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private readonly raycaster: THREE.Raycaster;
  private readonly pointer: THREE.Vector2;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: ThreeCtx,
    private readonly globe: GlobeView,
    private readonly rig: CameraRig,
    private readonly onClickDir: (dir: Vec3) => void,
  ) {
    this.raycaster = new ctx.THREE.Raycaster();
    this.pointer = new ctx.THREE.Vector2();

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.isDown = true;
    this.dragging = false;
    this.lastX = this.downX = e.clientX;
    this.lastY = this.downY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Синтетические события (тесты/автоматизация) могут не поддерживать capture.
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.isDown) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > DRAG_THRESHOLD_PX) {
      this.dragging = true;
    }
    if (this.dragging) this.rig.rotateBy(dx, dy);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.isDown = false;
    if (this.dragging) return;
    this.handleClick(e.clientX, e.clientY);
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.zoom = this.ctx.THREE.MathUtils.clamp(
      this.rig.zoom * (1 + e.deltaY * WHEEL_ZOOM_SENSITIVITY),
      ZOOM_MIN,
      ZOOM_MAX,
    );
  };

  private handleClick(clientX: number, clientY: number): void {
    this.pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    const hit = this.raycaster.intersectObject(this.globe.earthMesh)[0];
    if (!hit) return;
    const local = this.globe.earthMesh.worldToLocal(hit.point.clone()).normalize();
    this.onClickDir({ x: local.x, y: local.y, z: local.z });
  }
}
