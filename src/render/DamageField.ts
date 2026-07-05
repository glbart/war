// Накопительное equirect-поле урона планеты. R=глубина воронки, G=гарь, B=оплавление/полынья.
// Splat — разовый рендер мягкого штампа в точку эпицентра (не на кадр). Кратеры сливаются
// MAX-блендингом (наложения дают самую глубокую воронку, а не суммарную дыру).
import type * as THREE from 'three/webgpu';
import { uniform, vec4, uv, length, sub, vec2, smoothstep, float, clamp } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { dirToLonLat } from '../sim/geo';
import { DAMAGE_TEX_W, DAMAGE_TEX_H } from '../assets/config';

const ANG_BY_YIELD: Record<number, number> = { 1: 0.03, 10: 0.05, 100: 0.09 };

// Точные типы юниформов (как в ExplosionView): конкретный overload uniform() вместо размытого
// объединения перегрузок, чтобы .value имел тип Vector2 / number, а не keyof UniformValue.
function makeVec2Uniform(v: THREE.Vector2) {
  return uniform(v);
}
function makeFloatUniform(v: number) {
  return uniform(v);
}
type Vec2Uniform = ReturnType<typeof makeVec2Uniform>;
type FloatUniform = ReturnType<typeof makeFloatUniform>;

export class DamageField {
  private readonly rt: THREE.RenderTarget;
  private readonly stampScene: THREE.Scene;
  private readonly stampCam: THREE.OrthographicCamera;
  private readonly stampMesh: THREE.Mesh;
  private readonly uCenter: Vec2Uniform;
  private readonly uRadius: FloatUniform;
  private readonly uKind: FloatUniform; // 0=land, 1=ice

  constructor(private readonly ctx: ThreeCtx) {
    const { THREE } = ctx;
    this.rt = new THREE.RenderTarget(DAMAGE_TEX_W, DAMAGE_TEX_H, {
      depthBuffer: false,
      type: THREE.UnsignedByteType,
    });
    this.rt.texture.wrapS = THREE.RepeatWrapping; // корректный wrap по шву долготы

    this.stampScene = new THREE.Scene();
    // Орто-камера смотрит вдоль -Z; квад лежит в плоскости z=0, камера вынесена на z=1 с запасом
    // near/far по обе стороны — иначе при near=0 квад оказывается ровно на границе отсечения
    // (риск не отрендериться из-за погрешности округления на некоторых бэкендах).
    this.stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2);
    this.stampCam.position.z = 1;

    this.uCenter = makeVec2Uniform(new THREE.Vector2(0.5, 0.5));
    this.uRadius = makeFloatUniform(0.05);
    this.uKind = makeFloatUniform(0);

    // Профиль штампа: чаша глубины по расстоянию до центра (в UV, с поправкой на аспект 2:1).
    const d = length(sub(uv(), this.uCenter).mul(vec2(2, 1)));
    const bowl = smoothstep(this.uRadius, float(0), d); // 1 в центре → 0 на краю
    const depth = clamp(bowl, 0, 1);
    const char = clamp(bowl.mul(0.8), 0, 1);
    const melt = clamp(bowl.mul(this.uKind), 0, 1); // только лёд
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec4(depth, char, melt, 1);
    mat.transparent = false;
    // MAX-блендинг по всем каналам: наложения берут максимум (глубже/чернее/растопленнее).
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.MaxEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;

    this.stampMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.stampMesh.position.set(0.5, 0.5, 0);
    this.stampScene.add(this.stampMesh);
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  // Впечатывает воронку в поле. kind='ice' поднимает канал оплавления (полынья).
  splat(dir: Vec3, yieldMt: number, kind: 'land' | 'ice'): void {
    const { lon, lat } = dirToLonLat(dir);
    this.uCenter.value.set((lon + Math.PI) / (2 * Math.PI), (Math.PI / 2 - lat) / Math.PI);
    this.uRadius.value = ANG_BY_YIELD[yieldMt] ?? 0.05;
    this.uKind.value = kind === 'ice' ? 1 : 0;
    const prev = this.ctx.renderer.getRenderTarget();
    const prevAutoClear = this.ctx.renderer.autoClear;
    // autoClear=true (по умолчанию) заставил бы render() очистить цветовой буфер this.rt
    // перед отрисовкой штампа — весь накопленный ранее урон стирался бы на каждом splat().
    // Гасим autoClear на время рендера в rt и обязательно восстанавливаем после,
    // иначе сломается основной рендер сцены, который полагается на autoClear=true.
    this.ctx.renderer.autoClear = false;
    this.ctx.renderer.setRenderTarget(this.rt);
    this.ctx.renderer.render(this.stampScene, this.stampCam);
    this.ctx.renderer.setRenderTarget(prev);
    this.ctx.renderer.autoClear = prevAutoClear;
  }

  // Полная очистка поля (planetReset).
  clear(): void {
    const prev = this.ctx.renderer.getRenderTarget();
    this.ctx.renderer.setRenderTarget(this.rt);
    this.ctx.renderer.clearColor();
    this.ctx.renderer.setRenderTarget(prev);
  }
}
