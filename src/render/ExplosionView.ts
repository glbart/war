// Огненный шар + ударная волна взрыва (порт reference/earth-nuke.html ~758-840, таймлайн
// ~904-914). Их мало и они дёшевы, поэтому — по одному мешу на активный взрыв ИЗ ПУЛА
// (POOL_SIZE слотов), а не пересоздание геометрии/материалов на каждый взрыв. Все меши,
// материалы и юниформы строятся один раз в конструкторе; spawn() лишь активирует слот и
// задаёт ориентацию/цвет, update() гонит таймлайн через юниформы. НИКАКОГО динамического
// света (в демо был PointLight на взрыв — он заставлял three перекомпилировать шейдеры и был
// главным источником лагов): вспышка передаётся additive-огненным шаром, а не источником.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  float,
  vec3,
  clamp,
  pow,
  exp,
  mix,
  dot,
  lessThan,
  select,
  attribute,
  normalView,
  positionViewDirection,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { findFreeSlotIndex } from './SlotPool';

// Точные типы юниформов (ReturnType неперегруженной функции — конкретный UniformNode вместо
// размытого объединения перегрузок uniform), чтобы .value был number / Vector3.
function makeFloatUniform(v: number) {
  return uniform(v);
}
function makeVec3Uniform(v: THREE.Vector3) {
  return uniform(v);
}
type FloatUniform = ReturnType<typeof makeFloatUniform>;
type Vec3Uniform = ReturnType<typeof makeVec3Uniform>;

// Одновременных огненных шаров/волн. В штатной игре взрывов в кадре мало, но стресс/залп могут
// дать до ~десятка сразу; 12 слотов покрывают это без визуальных провалов. Простаивающие слоты
// схлопнуты в точку (scale 0, uOp 0) и почти ничего не стоят — меши/пайплайны построены раз.
const POOL_SIZE = 12;
const YS_BY_YIELD: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };
const TS_BY_YIELD: Record<number, number> = { 1: 0.8, 10: 1.0, 100: 1.4 };
const YIELDS = [1, 10, 100];

interface ExplosionSlot {
  readonly fireball: THREE.Mesh;
  readonly uFireColor: Vec3Uniform;
  readonly uFireOp: FloatUniform;
  readonly wave: THREE.Mesh;
  readonly uWaveR: FloatUniform;
  readonly uWaveOp: FloatUniform;
  readonly dir: THREE.Vector3; // переиспользуемый вектор нормали — без аллокаций в spawn
  active: boolean;
  t: number;
  ts: number;
  ys: number;
}

export class ExplosionView {
  private readonly slots: ExplosionSlot[] = [];
  // Геометрии волны по мощности (n=+Z, ориентируются кватернионом на spawn) — построены раз.
  private readonly waveGeos: Map<number, THREE.BufferGeometry> = new Map();
  // Цвета огненного шара как Vector3(r,g,b) — чтобы юниформ был vec3-узлом (а не color),
  // совместимым с TSL-выражением colorNode; лерп идёт по компонентам на CPU.
  private readonly fireA: THREE.Vector3;
  private readonly fireB: THREE.Vector3;
  private readonly unitZ: THREE.Vector3;

  constructor(
    private readonly ctx: ThreeCtx,
    parent: THREE.Group,
  ) {
    const { THREE } = ctx;
    this.fireA = new THREE.Vector3(1.0, 0.933, 0.6); // 0xffee99
    this.fireB = new THREE.Vector3(0.8, 0.2, 0.0); // 0xcc3300
    this.unitZ = new THREE.Vector3(0, 0, 1);

    for (const y of YIELDS) {
      const ys = YS_BY_YIELD[y] ?? 1;
      this.waveGeos.set(y, this.makeShockwaveGeometry(this.unitZ, 0.45 * ys, 1.008));
    }
    const fireballGeo = new THREE.SphereGeometry(1, 48, 32);
    for (let i = 0; i < POOL_SIZE; i++) this.slots.push(this.createSlot(parent, fireballGeo));
  }

  // Касательный базис из нормали (порт orthoBasis ~452-457).
  private orthoBasis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    const { THREE } = this.ctx;
    const t1 =
      Math.abs(n.y) < 0.99
        ? new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize()
        : new THREE.Vector3(1, 0, 0);
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    return [t1, t2];
  }

  // Сферический купол вокруг нормали n, полуугол maxAng, радиус R; атрибут aAng — доля углового
  // расстояния до края (порт makeShockwaveGeometry ~495-524). Строится один раз на мощность.
  private makeShockwaveGeometry(n: THREE.Vector3, maxAng: number, R: number): THREE.BufferGeometry {
    const { THREE } = this.ctx;
    const RS = 40;
    const AS = 96;
    const [t1, t2] = this.orthoBasis(n);
    const pos: number[] = [];
    const aAng: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= RS; j++) {
      const ang = (maxAng * j) / RS;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (let i = 0; i <= AS; i++) {
        const phi = (2 * Math.PI * i) / AS;
        const p = n
          .clone()
          .multiplyScalar(ca)
          .addScaledVector(t1, Math.cos(phi) * sa)
          .addScaledVector(t2, Math.sin(phi) * sa)
          .multiplyScalar(R);
        pos.push(p.x, p.y, p.z);
        aAng.push(j / RS);
      }
    }
    const W = AS + 1;
    for (let j = 0; j < RS; j++) {
      for (let i = 0; i < AS; i++) {
        const a = j * W + i;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aAng', new THREE.Float32BufferAttribute(aAng, 1));
    geo.setIndex(idx);
    return geo;
  }

  private createSlot(parent: THREE.Group, fireballGeo: THREE.SphereGeometry): ExplosionSlot {
    const { THREE } = this.ctx;
    // Огненный шар: fresnel-ядро (порт фрагментного шейдера ~778-786). uColor/uOp — на слот,
    // структура графа у всех слотов одинакова → пайплайн компилируется один раз и переиспользуется.
    const uFireColor = makeVec3Uniform(this.fireA.clone());
    const uFireOp = makeFloatUniform(0);
    const fireMat = new THREE.MeshBasicNodeMaterial();
    const k = clamp(dot(normalView, positionViewDirection), 0, 1);
    const a = pow(k, 1.6); // яркое ядро, прозрачный край
    fireMat.colorNode = uFireColor.mul(float(0.7).add(a.mul(0.5)));
    fireMat.opacityNode = a.mul(uFireOp);
    fireMat.transparent = true;
    fireMat.depthWrite = false;
    fireMat.blending = THREE.AdditiveBlending;
    const fireball = new THREE.Mesh(fireballGeo, fireMat);
    fireball.frustumCulled = false;
    fireball.scale.setScalar(0);
    fireball.renderOrder = 2;
    parent.add(fireball);

    // Ударная волна: фронт по угловому расстоянию (порт фрагментного шейдера ~822-834).
    const uWaveR = makeFloatUniform(0);
    const uWaveOp = makeFloatUniform(0);
    const waveMat = new THREE.MeshBasicNodeMaterial();
    const vAng = attribute<'float'>('aAng', 'float');
    const d = vAng.sub(uWaveR);
    const w = float(0.015).add(uWaveR.mul(0.06)); // фронт размывается с расстоянием
    const x = d.div(w);
    const front = exp(x.mul(x).negate()); // узкая яркая кромка
    const trail = select(lessThan(d, 0), exp(d.mul(9)).mul(0.3), float(0)); // пыльный шлейф
    waveMat.colorNode = mix(vec3(0.75, 0.6, 0.45), vec3(1.0, 0.93, 0.8), front);
    waveMat.opacityNode = front.add(trail).mul(uWaveOp);
    waveMat.transparent = true;
    waveMat.depthWrite = false;
    waveMat.side = THREE.DoubleSide;
    // Стартовая геометрия (заменяется по мощности на spawn); все геометрии волн имеют один
    // набор атрибутов (position, aAng) → одинаковый пайплайн, смена геометрии без перекомпиляции.
    const wave = new THREE.Mesh(this.waveGeos.get(10), waveMat);
    wave.frustumCulled = false;
    wave.scale.setScalar(0);
    wave.renderOrder = 3;
    parent.add(wave);

    return {
      fireball,
      uFireColor,
      uFireOp,
      wave,
      uWaveR,
      uWaveOp,
      dir: new THREE.Vector3(),
      active: false,
      t: 0,
      ts: 1,
      ys: 1,
    };
  }

  private acquireSlot(): ExplosionSlot | undefined {
    const idx = findFreeSlotIndex(this.slots);
    return idx === undefined ? undefined : this.slots[idx];
  }

  // Запускает огненный шар + ударную волну для взрыва в направлении dir (единичная нормаль,
  // локальные координаты parent). seed сейчас не влияет на форму этих эффектов (детерминированы),
  // но сохранён в сигнатуре ради единообразия с частицами и будущих вариаций.
  spawn(dir: Vec3, yieldMt: number, seed: number): void {
    void seed;
    const slot = this.acquireSlot();
    if (!slot) return; // пул исчерпан — graceful no-op (sim авторитетна, визуал не критичен)

    slot.active = true;
    slot.t = 0;
    slot.ts = TS_BY_YIELD[yieldMt] ?? 1;
    slot.ys = YS_BY_YIELD[yieldMt] ?? 1;
    slot.dir.set(dir.x, dir.y, dir.z).normalize();

    // Огненный шар — над эпицентром; масштаб/цвет прогонит update().
    slot.fireball.position.copy(slot.dir).multiplyScalar(1.01);
    slot.fireball.scale.setScalar(0.01);
    slot.uFireColor.value.copy(this.fireA);
    slot.uFireOp.value = 1;

    // Волна — подбираем геометрию по мощности и разворачиваем +Z→dir кватернионом.
    slot.wave.geometry = this.waveGeos.get(yieldMt) ?? this.waveGeos.get(10)!;
    slot.wave.quaternion.setFromUnitVectors(this.unitZ, slot.dir);
    slot.wave.scale.setScalar(1);
    slot.uWaveR.value = 0;
    slot.uWaveOp.value = 0.9;
  }

  // Гонит таймлайн активных взрывов (порт ~904-914). Всё через юниформы/трансформы — ни
  // одной аллокации и ни одной перекомпиляции шейдера.
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.t += dt;
      const tt = slot.t / slot.ts; // нормированное время взрыва

      // Огненный шар: медленно вспухает, гаснет ещё дольше, жёлтый→красный.
      const bk = Math.min(1, tt / 4.5);
      slot.fireball.scale.setScalar(0.01 + 0.11 * slot.ys * Math.sqrt(bk));
      slot.uFireOp.value = Math.max(0, Math.min(1, 1.2 - tt / 7));
      slot.uFireColor.value.copy(this.fireA).lerp(this.fireB, Math.min(1, tt / 5));

      // Ударная волна: быстрый старт, затухающее замедление у края.
      const rk = Math.min(1, tt / 12);
      slot.uWaveR.value = 1 - Math.pow(1 - rk, 1.8);
      slot.uWaveOp.value = 0.9 * (1 - rk);

      if (slot.t > 28 * slot.ts) {
        // totalLife = 28*ts (reference ~889)
        slot.active = false;
        slot.fireball.scale.setScalar(0);
        slot.uFireOp.value = 0;
        slot.wave.scale.setScalar(0);
        slot.uWaveOp.value = 0;
      }
    }
  }
}
