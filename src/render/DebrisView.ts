// Обломки-глыбы (этап 2 разрушаемости, спека 2026-07-14): инстансированные низкополи-камни.
// Баллистические — взлёт/падение параболой (как EjectaView), гаснут схлопыванием масштаба;
// орбитальные — спиральный взлёт и вечное кружение (кольцо мусора, копится до reset).
// Движение целиком в TSL от uTime из пер-инстансных атрибутов; CPU пишет атрибуты один раз
// в emit(). Материал непрозрачный (никакой альфы/сортировки), псевдоламберт от фиксированного
// направления — динамического света в проекте нет.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  instancedBufferAttribute,
  positionLocal,
  normalLocal,
  float,
  vec3,
  clamp,
  max,
  sin,
  cos,
  cross,
  normalize,
  abs,
  oneMinus,
  mix,
  dot,
  lessThan,
  select,
  smoothstep,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { landingDir, pickMaterial, debrisCount, DebrisSlots } from './debrisMath';
import {
  DEBRIS_ORBIT_SLOTS,
  DEBRIS_BALLISTIC_SLOTS,
  DEBRIS_ORBIT_FRAC,
  DEBRIS_SPEED_BY_YIELD,
  DEBRIS_ORBIT_R_MIN,
  DEBRIS_ORBIT_R_MAX,
  DEBRIS_ASCENT_T,
  DEBRIS_OMEGA_MIN,
  DEBRIS_OMEGA_MAX,
  DEBRIS_SIZE_MIN,
  DEBRIS_SIZE_MAX,
  DEBRIS_SOIL_COLOR,
  CRUST_LAYER_COLORS,
  EJECTA_GRAVITY,
} from '../assets/config';

const CAPACITY = DEBRIS_ORBIT_SLOTS + DEBRIS_BALLISTIC_SLOTS;

// Приземление баллистической глыбы: где и когда пыхнуть пылью (Scene → EjectaView.emitPuff).
export interface DebrisLanding {
  dir: Vec3;
  at: number;
}

function makeFloatUniform(v: number) {
  return uniform(v);
}

// Низкополи-«рваный» камень: икосаэдр с детерминированным джиттером вершин. Вершины
// PolyhedronGeometry дублированы по граням — хеш берётся от ИСХОДНОЙ позиции, поэтому
// дубликаты одной вершины смещаются одинаково и грани не рвутся; нормали пересчитываются
// плоскими (гранёный вид, как у кусков Surface Nets).
function buildRockGeometry(ctx: ThreeCtx): THREE.BufferGeometry {
  const geo = new ctx.THREE.IcosahedronGeometry(1, 0);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 0.72 + (h - Math.floor(h)) * 0.55; // 0.72..1.27
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class DebrisView {
  private readonly uTime = makeFloatUniform(0);
  private readonly aA: Float32Array; // (spawn, life, flag, angle)   flag: 0=баллистика, 1=орбита
  private readonly aB: Float32Array; // (v0, rSpeed, omega, orbitR)
  private readonly aC: Float32Array; // (dirX, dirY, dirZ, rotSpeed)
  private readonly aD: Float32Array; // (axisX, axisY, axisZ, rotPhase)
  private readonly aE: Float32Array; // (scaleX, scaleY, scaleZ, pad)
  private readonly aF: Float32Array; // (colR, colG, colB, pad)
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly slots = new DebrisSlots(DEBRIS_ORBIT_SLOTS, DEBRIS_BALLISTIC_SLOTS);
  private dirty = false;

  readonly mesh: THREE.InstancedMesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    this.aA = new Float32Array(CAPACITY * 4);
    this.aB = new Float32Array(CAPACITY * 4);
    this.aC = new Float32Array(CAPACITY * 4);
    this.aD = new Float32Array(CAPACITY * 4);
    this.aE = new Float32Array(CAPACITY * 4);
    this.aF = new Float32Array(CAPACITY * 4);
    // Незанятые слоты: spawn=+∞ → pt<0 → масштаб 0 (невидимы); life=1 против деления на ноль.
    for (let i = 0; i < CAPACITY; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1;
    }
    this.attrs = [this.aA, this.aB, this.aC, this.aD, this.aE, this.aF].map((arr) => {
      const attr = new THREE.InstancedBufferAttribute(arr, 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    });

    this.mesh = new THREE.InstancedMesh(buildRockGeometry(ctx), this.buildMaterial(ctx), CAPACITY);
    this.mesh.frustumCulled = false; // позиции задаются в шейдере
    parent.add(this.mesh);
  }

  // TSL-граф: масштаб → кувыркание (Родриг) → траектория (select орбита/баллистика).
  // CPU-зеркала формул — debrisMath.orbitalPos / EjectaView.ballisticHeight; менять синхронно.
  private buildMaterial(ctx: ThreeCtx): THREE.MeshBasicNodeMaterial {
    const { THREE } = ctx;
    const [atA, atB, atC, atD, atE, atF] = this.attrs as [
      THREE.InstancedBufferAttribute,
      THREE.InstancedBufferAttribute,
      THREE.InstancedBufferAttribute,
      THREE.InstancedBufferAttribute,
      THREE.InstancedBufferAttribute,
      THREE.InstancedBufferAttribute,
    ];
    const aA = instancedBufferAttribute<'vec4'>(atA, 'vec4');
    const aB = instancedBufferAttribute<'vec4'>(atB, 'vec4');
    const aC = instancedBufferAttribute<'vec4'>(atC, 'vec4');
    const aD = instancedBufferAttribute<'vec4'>(atD, 'vec4');
    const aE = instancedBufferAttribute<'vec4'>(atE, 'vec4');
    const aF = instancedBufferAttribute<'vec4'>(atF, 'vec4');

    const spawn = aA.x;
    const life = aA.y;
    const orbital = aA.z; // 0/1
    const angle = aA.w;
    const v0 = aB.x;
    const rSpeed = aB.y;
    const omega = aB.z;
    const orbitR = aB.w;
    const n = normalize(aC.xyz);
    const rotSpeed = aC.w;
    const axis = normalize(aD.xyz);
    const rotPhase = aD.w;
    const scaleV = aE.xyz;
    const baseColor = aF.xyz;

    const pt = this.uTime.sub(spawn);
    const tau = max(pt, 0);
    const lk = clamp(pt.div(life), 0, 1); // прогресс жизни (баллистика)
    const isBall = lessThan(orbital, float(0.5));

    // Гейт видимости: до рождения — 0; баллистика схлопывается к приземлению (масштабом,
    // не альфой — материал непрозрачный); орбитальные живут вечно.
    const alive = select(lessThan(pt, float(0)), float(0), float(1));
    const ballShrink = oneMinus(smoothstep(float(0.75), float(1), lk));
    const shrink = alive.mul(select(isBall, ballShrink, float(1)));

    // Кувыркание: поворот Родрига вокруг axis на угол rotSpeed·tau + rotPhase.
    const pScaled = positionLocal.mul(scaleV).mul(shrink);
    const rotA = rotSpeed.mul(tau).add(rotPhase);
    const cr = cos(rotA);
    const sr = sin(rotA);
    const pRot = pScaled
      .mul(cr)
      .add(cross(axis, pScaled).mul(sr))
      .add(axis.mul(dot(axis, pScaled)).mul(oneMinus(cr)));
    const nRot = normalLocal
      .mul(cr)
      .add(cross(axis, normalLocal).mul(sr))
      .add(axis.mul(dot(axis, normalLocal)).mul(oneMinus(cr)));

    // Касательный базис эпицентра (тот же алгоритм, что debrisMath.orthoBasis/EjectaView).
    const up = vec3(0, 1, 0);
    const t1 = select(lessThan(abs(n.y), 0.99), normalize(cross(n, up)), vec3(1, 0, 0));
    const t2 = normalize(cross(n, t1));
    const tangent = t1.mul(cos(angle)).add(t2.mul(sin(angle)));

    // Баллистика: h = v0·tau − ½g·tau² (кламп 0), снос rSpeed·tau (зеркало EjectaView).
    const g = float(EJECTA_GRAVITY);
    const h = max(v0.mul(tau).sub(g.mul(tau).mul(tau).mul(0.5)), 0);
    const posBall = n.mul(float(1).add(h)).add(tangent.mul(rSpeed.mul(tau)));

    // Орбита: θ=ω·tau, r: 1 → orbitR за DEBRIS_ASCENT_T (зеркало debrisMath.orbitalPos).
    const theta = omega.mul(tau);
    const rr = mix(float(1), orbitR, smoothstep(float(0), float(DEBRIS_ASCENT_T), tau));
    const posOrb = n
      .mul(cos(theta))
      .add(tangent.mul(sin(theta)))
      .mul(rr);

    const center = select(isBall, posBall, posOrb);

    // Псевдоламберт от фиксированного направления (динамического света нет).
    const light = normalize(vec3(0.5, 0.75, 0.44));
    const shade = float(0.45).add(max(dot(normalize(nRot), light), 0).mul(0.55));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = center.add(pRot);
    material.colorNode = clamp(baseColor.mul(shade), 0, 1);
    return material;
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Пишет атрибуты одной глыбы в слот i. Только присваивания в готовые массивы.
  private writeDebris(
    i: number,
    spawn: number,
    life: number,
    flag: number,
    angle: number,
    v0: number,
    rSpeed: number,
    omega: number,
    orbitR: number,
    dir: Vec3,
    rotSpeed: number,
    axis: Vec3,
    rotPhase: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    gcol: number,
    b: number,
  ): void {
    const o = i * 4;
    this.aA[o] = spawn;
    this.aA[o + 1] = life;
    this.aA[o + 2] = flag;
    this.aA[o + 3] = angle;
    this.aB[o] = v0;
    this.aB[o + 1] = rSpeed;
    this.aB[o + 2] = omega;
    this.aB[o + 3] = orbitR;
    this.aC[o] = dir.x;
    this.aC[o + 1] = dir.y;
    this.aC[o + 2] = dir.z;
    this.aC[o + 3] = rotSpeed;
    this.aD[o] = axis.x;
    this.aD[o + 1] = axis.y;
    this.aD[o + 2] = axis.z;
    this.aD[o + 3] = rotPhase;
    this.aE[o] = sx;
    this.aE[o + 1] = sy;
    this.aE[o + 2] = sz;
    this.aF[o] = r;
    this.aF[o + 1] = gcol;
    this.aF[o + 2] = b;
    this.dirty = true;
  }

  // Порождает глыбы удара. Детерминированный LCG от seed (как EjectaView.emit). Возвращает
  // приземления баллистических глыб — Scene превратит их в пыхи пыли (EjectaView.emitPuff).
  emit(
    dir: Vec3,
    yieldMt: number,
    seed: number,
    now: number,
    removedByMat: { soil: number; rock: number; basalt: number },
  ): DebrisLanding[] {
    const removed = removedByMat.soil + removedByMat.rock + removedByMat.basalt;
    const count = debrisCount(removed);
    if (count === 0) return [];
    const speedBase = DEBRIS_SPEED_BY_YIELD[yieldMt] ?? 0.2;

    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const TWO_PI = Math.PI * 2;
    const landings: DebrisLanding[] = [];

    for (let i = 0; i < count; i++) {
      const orbital = rnd() < DEBRIS_ORBIT_FRAC;
      const angle = rnd() * TWO_PI;
      // Цвет по материалу выбитого: грунт — конфиг, порода/базальт — палитра коры; джиттер яркости.
      const m = pickMaterial(rnd(), removedByMat);
      const [cr, cg, cb] =
        m === 'soil'
          ? DEBRIS_SOIL_COLOR
          : m === 'rock'
            ? CRUST_LAYER_COLORS.rock
            : CRUST_LAYER_COLORS.basalt;
      const bright = 0.85 + rnd() * 0.3;
      // Неравномерный пер-осевой масштаб — «рваность» силуэта без новых геометрий.
      const size = DEBRIS_SIZE_MIN + rnd() * (DEBRIS_SIZE_MAX - DEBRIS_SIZE_MIN);
      const sx = size * (0.7 + rnd() * 0.6);
      const sy = size * (0.7 + rnd() * 0.6);
      const sz = size * (0.7 + rnd() * 0.6);
      // Ось кувыркания — равномерно по сфере (детерминированно, из того же LCG).
      const az = rnd() * TWO_PI;
      const cz = rnd() * 2 - 1;
      const sxy = Math.sqrt(Math.max(0, 1 - cz * cz));
      const axis = { x: sxy * Math.cos(az), y: sxy * Math.sin(az), z: cz };
      const rotSpeed = (1 + rnd() * 3) * (rnd() < 0.5 ? -1 : 1);
      const rotPhase = rnd() * TWO_PI;

      if (orbital) {
        const omega =
          (DEBRIS_OMEGA_MIN + rnd() * (DEBRIS_OMEGA_MAX - DEBRIS_OMEGA_MIN)) *
          (rnd() < 0.5 ? -1 : 1);
        const orbitR = DEBRIS_ORBIT_R_MIN + rnd() * (DEBRIS_ORBIT_R_MAX - DEBRIS_ORBIT_R_MIN);
        this.writeDebris(
          this.slots.nextOrbital(),
          now,
          1,
          1,
          angle,
          0,
          0,
          omega,
          orbitR,
          dir,
          rotSpeed,
          axis,
          rotPhase,
          sx,
          sy,
          sz,
          cr * bright,
          cg * bright,
          cb * bright,
        );
      } else {
        const v0 = speedBase * (0.5 + rnd() * 0.9);
        const rSpeed = v0 * (0.3 + rnd() * 0.7);
        const life = (2 * v0) / EJECTA_GRAVITY;
        this.writeDebris(
          this.slots.nextBallistic(),
          now,
          life,
          0,
          angle,
          v0,
          rSpeed,
          0,
          1,
          dir,
          rotSpeed,
          axis,
          rotPhase,
          sx,
          sy,
          sz,
          cr * bright,
          cg * bright,
          cb * bright,
        );
        landings.push({ dir: landingDir(dir, angle, rSpeed * life), at: now + life });
      }
    }

    this.flush();
    return landings;
  }

  // Сброс планеты: все слоты в «никогда не родится», курсоры в начало.
  clear(): void {
    for (let i = 0; i < CAPACITY; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1;
    }
    this.slots.reset();
    this.dirty = true;
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    for (const attr of this.attrs) attr.needsUpdate = true;
    this.dirty = false;
  }
}
