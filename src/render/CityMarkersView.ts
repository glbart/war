// Маркеры городов по сторонам конфликта (спека 2026-08-29-factions-design.md): один
// InstancedMesh на все города, цвет — цвет стороны-владельца, размер — от населения.
// Живучесть города (alive/pop) уменьшает и гасит его маркер: опустошённая агломерация
// остаётся тёмной точкой, а не исчезает.
//
// Ноль работы CPU на кадр: атрибуты переписываются только по событиям симуляции
// (cityHit / planetReset). Список городов берётся из того же чистого createCities(),
// что и у симуляции — детерминированные данные, общие для sim и рендера (как landmask
// и ballistics); изменяемое состояние сюда приходит событиями, а не читается из sim.
import type * as THREE from 'three/webgpu';
import { instancedBufferAttribute, positionLocal } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { createCities } from '../sim/cities';
import { factionById } from '../sim/factions';
import {
  MARKER_R,
  MARKER_SIZE_MIN,
  MARKER_SIZE_MAX,
  MARKER_POP_REF,
  MARKER_DEAD_SIZE_FRAC,
  MARKER_DEAD_COLOR_FRAC,
} from '../assets/config';

// Базовый размер маркера по населению города (млн): линейно до MARKER_POP_REF, дальше кламп.
function sizeForPop(pop: number): number {
  const k = Math.min(1, Math.max(0, pop / MARKER_POP_REF));
  return MARKER_SIZE_MIN + (MARKER_SIZE_MAX - MARKER_SIZE_MIN) * k;
}

export class CityMarkersView {
  private readonly cities = createCities(); // порядок = индекс инстанса (и не меняется)
  private readonly index = new Map<string, number>();
  private readonly aPos: Float32Array; // (x, y, z, size)
  private readonly aColor: Float32Array; // (r, g, b, pad)
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly colorAttr: THREE.InstancedBufferAttribute;

  readonly mesh: THREE.InstancedMesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    const n = this.cities.length;
    this.aPos = new Float32Array(n * 4);
    this.aColor = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.index.set(this.cities[i]!.name, i);

    this.posAttr = new THREE.InstancedBufferAttribute(this.aPos, 4);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.aColor, 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);

    const aPos = instancedBufferAttribute<'vec4'>(this.posAttr, 'vec4');
    const aColor = instancedBufferAttribute<'vec4'>(this.colorAttr, 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    // Вся математика живучести уже в атрибутах (CPU пишет их по событию) — в шейдере
    // остаётся только сдвиг инстанса и его размер.
    material.positionNode = aPos.xyz.add(positionLocal.mul(aPos.w));
    material.colorNode = aColor.xyz;

    // Октаэдр — 8 треугольников на маркер: 266 городов ≈ 2k треугольников, дешевле сферы.
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), material, n);
    this.mesh.frustumCulled = false; // позиции задаются в шейдере
    parent.add(this.mesh);

    this.clear();
  }

  // Пишет маркер города i при доле выживших f (1 — целый город, 0 — опустошённый).
  private write(i: number, f: number): void {
    const city = this.cities[i]!;
    const alive = Math.min(1, Math.max(0, f));
    const size =
      sizeForPop(city.pop) * (MARKER_DEAD_SIZE_FRAC + (1 - MARKER_DEAD_SIZE_FRAC) * alive);
    const dim = MARKER_DEAD_COLOR_FRAC + (1 - MARKER_DEAD_COLOR_FRAC) * alive;
    const color = factionById(city.faction).color;
    this.aPos[i * 4] = city.dir.x * MARKER_R;
    this.aPos[i * 4 + 1] = city.dir.y * MARKER_R;
    this.aPos[i * 4 + 2] = city.dir.z * MARKER_R;
    this.aPos[i * 4 + 3] = size;
    this.aColor[i * 4] = color[0] * dim;
    this.aColor[i * 4 + 1] = color[1] * dim;
    this.aColor[i * 4 + 2] = color[2] * dim;
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  // Событие cityHit: alive — ОСТАВШЕЕСЯ население города (млн), pop берём из своих данных.
  setAlive(name: string, alive: number): void {
    const i = this.index.get(name);
    if (i === undefined) return; // город не из нашего набора — молча игнорируем
    const pop = this.cities[i]!.pop;
    this.write(i, pop > 0 ? alive / pop : 0);
  }

  // planetReset: все города снова целы.
  clear(): void {
    for (let i = 0; i < this.cities.length; i++) this.write(i, 1);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }
}
