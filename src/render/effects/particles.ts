// GPU-инстансированные частицы грибовидного облака (порт распределения из
// reference/earth-nuke.html ~842-933). Вместо ~150 отдельных THREE.Sprite на каждый взрыв —
// ДВА InstancedMesh на всю сцену (огонь: additive; дым: normal — разные режимы смешивания
// требуют разных материалов, поэтому один меш физически невозможен). Позиция/размер/цвет/
// прозрачность КАЖДОЙ частицы считаются в вершинном/фрагментном шейдере (TSL) из инстанс-
// атрибутов (aA/aB/aC) и общего юниформа uTime. emit() лишь пишет параметры пачки в
// кольцевой буфер типизированных массивов + needsUpdate; setTime() обновляет uTime. Ни одного
// JS-объекта на частицу, ни одной аллокации на кадр проигрывания, ни одного пересчёта на CPU.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  instancedBufferAttribute,
  uv,
  float,
  vec3,
  clamp,
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
} from 'three/tsl';
import type { ThreeCtx } from '../Renderer';
import type { Vec3 } from '../../sim/geo';

// Точный тип float-юниформа (ReturnType неперегруженной функции даёт конкретный UniformNode,
// а не размытое объединение перегрузок uniform) — чтобы .value был number и работал .sub().
function makeFloatUniform(v: number) {
  return uniform(v);
}
type FloatUniform = ReturnType<typeof makeFloatUniform>;

// Поправки на мощность заряда (порт detonate() ~724-726): ys — масштаб размеров/высоты,
// ts — растяжение таймингов (мощный взрыв разворачивается медленнее и тяжелее).
const YS_BY_YIELD: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };
const TS_BY_YIELD: Record<number, number> = { 1: 0.8, 10: 1.0, 100: 1.4 };

// Вместимость пулов: на один взрыв ~70 огненных + ~76 дымовых частиц (46 ножка + 24 огня
// шляпки; 46 дыма шляпки + 30 дыма ножки). 2000 на пул ≈ 27 одновременных взрывов до
// заворота кольца — с запасом покрывает стресс-тест из 12 взрывов.
const FIRE_CAPACITY = 2000;
const SMOKE_CAPACITY = 2000;

// Цвета из reference (~887-888): огонь жёлтый→красный, дым серо-бежевый→почти чёрный.
const FIRE_A = vec3(1.0, 0.933, 0.6); // 0xffee99
const FIRE_B = vec3(0.8, 0.2, 0.0); // 0xcc3300
const SMOKE_A = vec3(0.466, 0.4, 0.333); // 0x776655
const SMOKE_B = vec3(0.164, 0.164, 0.18); // 0x2a2a2e

// Один инстанс-меш частиц одного режима смешивания. Держит три vec4-атрибута на инстанс:
//   aA = (spawn, life, fadeDur, angle)   — тайминги и азимут
//   aB = (h0, h1, r, g)                  — вертикальная кривая и радиальный разлёт
//   aC = (dirX, dirY, dirZ, size)        — нормаль эпицентра (единичная) + размер спрайта
// Незанятые слоты имеют size=0 и spawn=+бесконечность → в шейдере схлопываются в невидимую точку.
class ParticleMesh {
  private readonly aA: Float32Array;
  private readonly aB: Float32Array;
  private readonly aC: Float32Array;
  private readonly attrA: THREE.InstancedBufferAttribute;
  private readonly attrB: THREE.InstancedBufferAttribute;
  private readonly attrC: THREE.InstancedBufferAttribute;
  private write = 0; // курсор кольцевого буфера
  private dirty = false;

  readonly mesh: THREE.InstancedMesh;

  constructor(
    ctx: ThreeCtx,
    parent: THREE.Group,
    private readonly capacity: number,
    uTime: FloatUniform,
    additive: boolean,
  ) {
    const { THREE } = ctx;
    this.aA = new Float32Array(capacity * 4);
    this.aB = new Float32Array(capacity * 4);
    this.aC = new Float32Array(capacity * 4);
    // spawn = +∞ у всех слотов, пока не заполнены — гарантирует pt<0 → невидимы (и size=0).
    for (let i = 0; i < capacity; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1; // life=1, чтобы не делить на ноль в шейдере
    }
    this.attrA = new THREE.InstancedBufferAttribute(this.aA, 4);
    this.attrB = new THREE.InstancedBufferAttribute(this.aB, 4);
    this.attrC = new THREE.InstancedBufferAttribute(this.aC, 4);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    this.attrC.setUsage(THREE.DynamicDrawUsage);

    const material = this.buildMaterial(ctx, uTime, additive);
    // Квадрат [-0.5..0.5] с uv [0..1] — SpriteNodeMaterial сам разворачивает его лицом к камере.
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity);
    this.mesh.frustumCulled = false; // позиция задаётся в шейдере, bounding sphere бесполезен
    this.mesh.renderOrder = 4;
    parent.add(this.mesh);
  }

  // TSL-граф частицы: перенос кривых движения из reference (~916-933) в узлы.
  private buildMaterial(
    ctx: ThreeCtx,
    uTime: FloatUniform,
    additive: boolean,
  ): THREE.SpriteNodeMaterial {
    const { THREE } = ctx;
    // Явный generic <'vec4'> даёт типизированный узел со свизлами (.x/.y/.z/.w/.xyz);
    // runtime-тип выводится из itemSize=4 (второй аргумент можно опустить).
    const aA = instancedBufferAttribute<'vec4'>(this.attrA, 'vec4');
    const aB = instancedBufferAttribute<'vec4'>(this.attrB, 'vec4');
    const aC = instancedBufferAttribute<'vec4'>(this.attrC, 'vec4');

    const spawn = aA.x;
    const life = aA.y;
    const fadeDur = aA.z;
    const angle = aA.w;
    const h0 = aB.x;
    const h1 = aB.y;
    const r = aB.z;
    const g = aB.w;
    const n = normalize(aC.xyz);
    const size = aC.w;

    const pt = uTime.sub(spawn); // время жизни частицы (может быть <0 до рождения)
    const lk = clamp(pt.div(life), 0, 1); // нормированный прогресс 0..1
    const rise = oneMinus(oneMinus(lk).mul(oneMinus(lk))); // 1-(1-lk)^2 — замедление подъёма
    const h = h0.add(h1.sub(h0).mul(rise)); // высота над поверхностью
    const radial = r.add(g.mul(rise)); // радиальный разлёт от оси
    const wobble = sin(pt.mul(0.7).add(angle)).mul(0.004); // лёгкое покачивание

    // Касательный базис из нормали (порт orthoBasis ~452-457) — прямо в шейдере, без атрибутов.
    const up = vec3(0, 1, 0);
    const t1 = select(lessThan(abs(n.y), 0.99), normalize(cross(n, up)), vec3(1, 0, 0));
    const t2 = normalize(cross(n, t1));

    // pos = surface*(1+h) + t1*(cos*radial + wobble) + t2*(sin*radial)
    const pos = n
      .mul(float(1).add(h))
      .add(t1.mul(cos(angle).mul(radial).add(wobble)))
      .add(t2.mul(sin(angle).mul(radial)));

    const scale = size.mul(float(0.4).add(rise.mul(1.1))); // размер растёт по прогрессу

    // Мягкий радиальный спад вместо softTex-текстуры: soft = 1 - 2*|uv-0.5|.
    const d = uv().sub(0.5);
    const soft = clamp(oneMinus(dot(d, d).sqrt().mul(2)), 0, 1);
    const fadeIn = clamp(pt.div(fadeDur), 0, 1);
    const kindOpacity = additive ? 0.85 : 0.65;
    const alpha = fadeIn.mul(kindOpacity).mul(oneMinus(lk)).mul(soft);

    const color = additive ? mix(FIRE_A, FIRE_B, lk) : mix(SMOKE_A, SMOKE_B, lk.mul(0.8));

    const material = new THREE.SpriteNodeMaterial();
    material.positionNode = pos;
    material.scaleNode = scale;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    return material;
  }

  // Пишет одну частицу в текущий слот кольцевого буфера. Только присваивания в готовые массивы.
  writeParticle(
    spawn: number,
    life: number,
    fadeDur: number,
    angle: number,
    h0: number,
    h1: number,
    r: number,
    g: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    size: number,
  ): void {
    const i = this.write;
    const o = i * 4;
    this.aA[o] = spawn;
    this.aA[o + 1] = life;
    this.aA[o + 2] = fadeDur;
    this.aA[o + 3] = angle;
    this.aB[o] = h0;
    this.aB[o + 1] = h1;
    this.aB[o + 2] = r;
    this.aB[o + 3] = g;
    this.aC[o] = dirX;
    this.aC[o + 1] = dirY;
    this.aC[o + 2] = dirZ;
    this.aC[o + 3] = size;
    this.write = (i + 1) % this.capacity;
    this.dirty = true;
  }

  // Заливает изменённые атрибуты на GPU одним махом (только если что-то писали).
  flush(): void {
    if (!this.dirty) return;
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
    this.attrC.needsUpdate = true;
    this.dirty = false;
  }

  // Немедленно гасит все частицы (planetReset): spawn=+∞ → невидимы, курсор в начало.
  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1;
    }
    this.write = 0;
    this.dirty = true;
    this.flush();
  }
}

export class ParticlePool {
  private readonly uTime = makeFloatUniform(0);
  private readonly fire: ParticleMesh;
  private readonly smoke: ParticleMesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    this.fire = new ParticleMesh(ctx, parent, FIRE_CAPACITY, this.uTime, true);
    this.smoke = new ParticleMesh(ctx, parent, SMOKE_CAPACITY, this.uTime, false);
  }

  // Обновляет общие часы шейдера (секунды). Вызывается раз за кадр.
  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Немедленно гасит огонь и дым гриба (planetReset) — включая ещё не родившиеся частицы
  // с отложенным spawn.
  clear(): void {
    this.fire.clear();
    this.smoke.clear();
  }

  // Порождает пачку частиц гриба для взрыва в направлении dir (единичная нормаль эпицентра,
  // локальные координаты parent). now — текущее значение часов (см. setTime): спавн частицы =
  // now + delay. Детерминированный RNG от seed — стабильная картинка между запусками.
  emit(dir: Vec3, yieldMt: number, seed: number, now: number): void {
    const ys = YS_BY_YIELD[yieldMt] ?? 1;
    const ts = TS_BY_YIELD[yieldMt] ?? 1;
    const fadeDur = 0.8 * ts;

    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const TWO_PI = Math.PI * 2;

    const stemH = 0.28 * ys;
    const capR = 0.11 * ys;

    // Ножка: 46 огненных частиц (порт ~846-853).
    for (let i = 0; i < 46; i++) {
      this.fire.writeParticle(
        now + rnd() * 1.2 * ts,
        (7 + rnd() * 4) * ts,
        fadeDur,
        rnd() * TWO_PI,
        0.01,
        stemH * (0.25 + rnd() * 0.75),
        0.01 + rnd() * 0.028 * ys,
        0.008 + rnd() * 0.02,
        dir.x,
        dir.y,
        dir.z,
        (0.03 + rnd() * 0.045) * ys,
      );
    }

    // Шляпка: 70 частиц, первые 24 — огонь, остальные дым (порт ~855-863).
    for (let i = 0; i < 70; i++) {
      const target = i < 24 ? this.fire : this.smoke;
      target.writeParticle(
        now + (2.0 + rnd() * 2.5) * ts,
        (14 + rnd() * 8) * ts,
        fadeDur,
        rnd() * TWO_PI,
        stemH * 0.85,
        stemH * (0.95 + rnd() * 0.3),
        0.01,
        capR * (0.4 + rnd() * 0.9),
        dir.x,
        dir.y,
        dir.z,
        (0.05 + rnd() * 0.07) * ys,
      );
    }

    // Дым по ножке: 30 частиц (порт ~864-872).
    for (let i = 0; i < 30; i++) {
      this.smoke.writeParticle(
        now + (2.5 + rnd() * 4) * ts,
        (16 + rnd() * 7) * ts,
        fadeDur,
        rnd() * TWO_PI,
        0.02,
        stemH * (0.3 + rnd() * 0.7),
        0.015 + rnd() * 0.03 * ys,
        0.01 + rnd() * 0.02,
        dir.x,
        dir.y,
        dir.z,
        (0.04 + rnd() * 0.06) * ys,
      );
    }

    this.fire.flush();
    this.smoke.flush();
  }
}
