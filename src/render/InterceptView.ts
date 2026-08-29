// Вспышки работы ПРО (спека 2026-08-29-abm-escalation-victory §2): короткий расширяющийся
// всполох в точке перехвата. Один InstancedMesh с кольцевым буфером слотов; вся анимация —
// в TSL от uTime по пер-инстансным атрибутам (паттерн EjectaView/DebrisView), CPU пишет
// атрибуты только в момент события.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  instancedBufferAttribute,
  positionLocal,
  float,
  vec3,
  clamp,
  mix,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import {
  INTERCEPT_SLOTS,
  INTERCEPT_FLASH_T,
  INTERCEPT_FLASH_SIZE,
  INTERCEPT_HIT_COLOR,
  INTERCEPT_MISS_COLOR,
} from '../assets/config';

function makeFloatUniform(v: number) {
  return uniform(v);
}

export class InterceptView {
  private readonly uTime = makeFloatUniform(0);
  private readonly aPos: Float32Array; // (x, y, z, spawn)
  private readonly aCfg: Float32Array; // (success 0/1, pad, pad, pad)
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly cfgAttr: THREE.InstancedBufferAttribute;
  private cursor = 0;

  readonly mesh: THREE.InstancedMesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    this.aPos = new Float32Array(INTERCEPT_SLOTS * 4);
    this.aCfg = new Float32Array(INTERCEPT_SLOTS * 4);
    for (let i = 0; i < INTERCEPT_SLOTS; i++) this.aPos[i * 4 + 3] = -1e9; // пустые слоты позади

    this.posAttr = new THREE.InstancedBufferAttribute(this.aPos, 4);
    this.cfgAttr = new THREE.InstancedBufferAttribute(this.aCfg, 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.cfgAttr.setUsage(THREE.DynamicDrawUsage);

    const aPos = instancedBufferAttribute<'vec4'>(this.posAttr, 'vec4');
    const aCfg = instancedBufferAttribute<'vec4'>(this.cfgAttr, 'vec4');
    const age = this.uTime.sub(aPos.w);
    const k = clamp(age.div(INTERCEPT_FLASH_T), 0, 1);
    // Расширяющийся всполох, гаснущий к концу жизни: масштаб растёт, яркость падает.
    const scale = float(INTERCEPT_FLASH_SIZE).mul(float(0.25).add(k.mul(1.5)));
    const fade = clamp(float(1).sub(k), 0, 1);
    const hit = vec3(INTERCEPT_HIT_COLOR[0], INTERCEPT_HIT_COLOR[1], INTERCEPT_HIT_COLOR[2]);
    const miss = vec3(INTERCEPT_MISS_COLOR[0], INTERCEPT_MISS_COLOR[1], INTERCEPT_MISS_COLOR[2]);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = aPos.xyz.add(positionLocal.mul(scale));
    material.colorNode = mix(miss, hit, aCfg.x).mul(fade.mul(fade));
    material.transparent = true;
    material.opacityNode = fade;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      material,
      INTERCEPT_SLOTS,
    );
    this.mesh.frustumCulled = false; // позиции задаются в шейдере
    parent.add(this.mesh);
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Вспышка в точке pos (координаты в радиусах планеты, как приходит из симуляции).
  spawn(pos: Vec3, success: boolean, now: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % INTERCEPT_SLOTS;
    this.aPos[i * 4] = pos.x;
    this.aPos[i * 4 + 1] = pos.y;
    this.aPos[i * 4 + 2] = pos.z;
    this.aPos[i * 4 + 3] = now;
    this.aCfg[i * 4] = success ? 1 : 0;
    this.posAttr.needsUpdate = true;
    this.cfgAttr.needsUpdate = true;
  }

  // Гасит все вспышки (planetReset): спавн уводится далеко в прошлое.
  clear(): void {
    for (let i = 0; i < INTERCEPT_SLOTS; i++) this.aPos[i * 4 + 3] = -1e9;
    this.posAttr.needsUpdate = true;
  }
}
