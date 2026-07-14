// Магма-подложка под корой: эмиссивная сфера (MeshBasicNodeMaterial = unlit, «светится» сама,
// без динамического света — ограничение движка). Видна только сквозь пробития коры: глобус
// сверху непрозрачен, кора закрывает бока. Пульсация — fbm по positionLocal + uTime.
import type * as THREE from 'three/webgpu';
import { uniform, vec3, mix, positionLocal, clamp } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { MAGMA_R } from '../assets/config';
import { fbm3 } from './noise';

function makeFloatUniform(v: number) {
  return uniform(v);
}

export class MagmaCore {
  private readonly uTime = makeFloatUniform(0);
  private readonly uBoost = makeFloatUniform(0); // разгорание ядра при расколе (этап 4)
  readonly mesh: THREE.Mesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    const mat = new THREE.MeshBasicNodeMaterial();
    const n = fbm3(positionLocal.mul(6.0).add(vec3(0, 0, this.uTime.mul(0.15))), 4);
    const glow = clamp(n.mul(1.4), 0, 1);
    const base = mix(vec3(0.45, 0.05, 0.0), vec3(1.0, 0.55, 0.1), glow);
    // Буст раскола (этап 4): обнажённое ядро разгорается к бело-жёлтому.
    mat.colorNode = mix(base, vec3(1.0, 0.85, 0.45), this.uBoost.mul(0.65));
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(MAGMA_R, 96, 48), mat);
    parent.add(this.mesh);
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Буст раскола [0..1] — гонит Scene.update (агония → 1 к моменту распада).
  setBoost(v: number): void {
    this.uBoost.value = v;
  }
}
