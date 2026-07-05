// Баллистические частицы выброса грунта при ударе по суше: спавн из эпицентра, разлёт
// наружу+вверх, падение обратно под «гравитацией» (парабола), гаснут у поверхности. Инстанс-
// спрайты, движение в TSL из атрибутов, кольцевой буфер типизированных массивов, один uTime,
// ноль аллокаций/кадр — тот же паттерн, что ParticleMesh/ParticlePool (см. effects/particles.ts),
// но кривая высоты — баллистическая (взлёт+падение), а не монотонный подъём гриба. Цвет — грунт/
// пыль (бурый→серый), доля частиц — тёмные обломки породы.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  instancedBufferAttribute,
  uv,
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
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { EJECTA_COUNT_BY_YIELD, EJECTA_SPEED_BY_YIELD, EJECTA_GRAVITY } from '../assets/config';

// Точный тип float-юниформа (ReturnType неперегруженной функции даёт конкретный UniformNode,
// а не размытое объединение перегрузок uniform) — чтобы .value был number.
function makeFloatUniform(v: number) {
  return uniform(v);
}

// Чистая баллистика: высота над поверхностью в момент tau при начальной вертикальной
// скорости v0 и «гравитации» g. Клампится к 0 — частица не уходит под поверхность после
// приземления (используется и здесь на CPU для расчёта времени жизни, и как образец для
// зеркального TSL-графа ниже).
export function ballisticHeight(v0: number, g: number, tau: number): number {
  return Math.max(0, v0 * tau - 0.5 * g * tau * tau);
}

// Вместимость пула: на взрыв максимум 140 частиц (yield=100); 2000 слотов ≈ 14 одновременных
// взрывов до заворота кольца — с запасом для стресс-теста залпом.
const CAPACITY = 2000;

// Цвета грунта/пыли: бурая пыль → серая зола, плюс отдельный цвет тёмных обломков породы
// для доли частиц (см. dark-атрибут).
const DUST_A = vec3(0.42, 0.32, 0.22); // бурый грунт
const DUST_B = vec3(0.55, 0.53, 0.5); // серая пыль
const DEBRIS = vec3(0.12, 0.1, 0.09); // тёмные обломки породы

export class EjectaView {
  private readonly uTime = makeFloatUniform(0);
  private readonly uGravity = makeFloatUniform(EJECTA_GRAVITY);
  private readonly aA: Float32Array; // (spawn, life, fadeDur, angle)
  private readonly aB: Float32Array; // (v0, rSpeed, dark, size)
  private readonly aC: Float32Array; // (dirX, dirY, dirZ, pad)
  private readonly attrA: THREE.InstancedBufferAttribute;
  private readonly attrB: THREE.InstancedBufferAttribute;
  private readonly attrC: THREE.InstancedBufferAttribute;
  private write = 0; // курсор кольцевого буфера
  private dirty = false;

  readonly mesh: THREE.InstancedMesh;

  constructor(ctx: ThreeCtx, parent: THREE.Group) {
    const { THREE } = ctx;
    this.aA = new Float32Array(CAPACITY * 4);
    this.aB = new Float32Array(CAPACITY * 4);
    this.aC = new Float32Array(CAPACITY * 4);
    // spawn = +∞ у незанятых слотов, пока не заполнены — гарантирует pt<0 → alpha=0.
    for (let i = 0; i < CAPACITY; i++) {
      this.aA[i * 4] = 1e9;
      this.aA[i * 4 + 1] = 1; // life=1, чтобы не делить на ноль в шейдере
    }
    this.attrA = new THREE.InstancedBufferAttribute(this.aA, 4);
    this.attrB = new THREE.InstancedBufferAttribute(this.aB, 4);
    this.attrC = new THREE.InstancedBufferAttribute(this.aC, 4);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    this.attrC.setUsage(THREE.DynamicDrawUsage);

    const material = this.buildMaterial(ctx);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, CAPACITY);
    this.mesh.frustumCulled = false; // позиция задаётся в шейдере, bounding sphere бесполезен
    this.mesh.renderOrder = 4;
    parent.add(this.mesh);
  }

  // TSL-граф частицы: та же баллистика, что ballisticHeight() выше, но узлами (mul/sub/max)
  // из атрибутов (v0, uGravity, spawn) вместо чисел на CPU.
  private buildMaterial(ctx: ThreeCtx): THREE.SpriteNodeMaterial {
    const { THREE } = ctx;
    const aA = instancedBufferAttribute<'vec4'>(this.attrA, 'vec4');
    const aB = instancedBufferAttribute<'vec4'>(this.attrB, 'vec4');
    const aC = instancedBufferAttribute<'vec4'>(this.attrC, 'vec4');

    const spawn = aA.x;
    const life = aA.y;
    const fadeDur = aA.z;
    const angle = aA.w;
    const v0 = aB.x;
    const rSpeed = aB.y;
    const dark = aB.z;
    const size = aB.w;
    const n = normalize(aC.xyz);

    const pt = this.uTime.sub(spawn); // время жизни частицы (может быть <0 до рождения)
    const tau = max(pt, 0); // баллистика считается от неотрицательного времени полёта
    const lk = clamp(pt.div(life), 0, 1); // нормированный прогресс 0..1 (для фейда)

    // h = v0·tau − ½·g·tau² (клампится к 0) — зеркало ballisticHeight() из TSL-узлов.
    const h = max(v0.mul(tau).sub(this.uGravity.mul(tau).mul(tau).mul(0.5)), 0);
    const radial = rSpeed.mul(tau); // разлёт от эпицентра растёт со временем полёта

    // Касательный базис из нормали эпицентра (порт orthoBasis, как в particles.ts/OceanShell).
    const up = vec3(0, 1, 0);
    const t1 = select(lessThan(abs(n.y), 0.99), normalize(cross(n, up)), vec3(1, 0, 0));
    const t2 = normalize(cross(n, t1));

    // pos = surface*(1+h) + t1*cos*radial + t2*sin*radial
    const pos = n
      .mul(float(1).add(h))
      .add(t1.mul(cos(angle).mul(radial)))
      .add(t2.mul(sin(angle).mul(radial)));

    const scale = size.mul(float(0.7).add(oneMinus(lk).mul(0.3))); // чуть съёживается к концу

    // Мягкий радиальный спад вместо текстуры: soft = 1 - 2*|uv-0.5|.
    const d = uv().sub(0.5);
    const soft = clamp(oneMinus(dot(d, d).sqrt().mul(2)), 0, 1);
    const fadeIn = clamp(pt.div(fadeDur), 0, 1);
    // Гаснут к концу жизни/у поверхности: life задаётся в emit() равным времени полёта, так что
    // lk→1 совпадает с h→0 (приземление).
    const alpha = fadeIn.mul(0.75).mul(oneMinus(lk)).mul(soft);

    // Грунт/пыль (бурый→серый) по прогрессу полёта; доля частиц — тёмные обломки породы
    // (dark — детерминированный 0/1 из RNG в emit(), см. ниже).
    const dustColor = mix(DUST_A, DUST_B, lk);
    const color = mix(dustColor, DEBRIS, dark);

    const material = new THREE.SpriteNodeMaterial();
    material.positionNode = pos;
    material.scaleNode = scale;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    return material;
  }

  // Пишет одну частицу в текущий слот кольцевого буфера. Только присваивания в готовые массивы.
  private writeParticle(
    spawn: number,
    life: number,
    fadeDur: number,
    angle: number,
    v0: number,
    rSpeed: number,
    dark: number,
    size: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): void {
    const i = this.write;
    const o = i * 4;
    this.aA[o] = spawn;
    this.aA[o + 1] = life;
    this.aA[o + 2] = fadeDur;
    this.aA[o + 3] = angle;
    this.aB[o] = v0;
    this.aB[o + 1] = rSpeed;
    this.aB[o + 2] = dark;
    this.aB[o + 3] = size;
    this.aC[o] = dirX;
    this.aC[o + 1] = dirY;
    this.aC[o + 2] = dirZ;
    this.write = (i + 1) % CAPACITY;
    this.dirty = true;
  }

  // Обновляет общие часы шейдера (секунды). Вызывается раз за кадр.
  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Порождает пачку баллистических частиц выброса для удара в направлении dir (единичная
  // нормаль эпицентра, локальные координаты parent). now — текущее значение часов (см.
  // setTime): спавн частицы = now (без задержки — выброс мгновенный при ударе). Детерминированный
  // RNG от seed — стабильная картинка между запусками (как ParticlePool.emit).
  emit(dir: Vec3, yieldMt: number, seed: number, now: number): void {
    const count = EJECTA_COUNT_BY_YIELD[yieldMt] ?? 80;
    const speedBase = EJECTA_SPEED_BY_YIELD[yieldMt] ?? 0.2;

    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const TWO_PI = Math.PI * 2;

    for (let i = 0; i < count; i++) {
      const angle = rnd() * TWO_PI;
      const v0 = speedBase * (0.6 + rnd() * 0.8); // разброс начальной скорости
      const rSpeed = v0 * (0.4 + rnd() * 0.6); // горизонтальная доля скорости выброса
      // Время полёта = время возврата параболы к 0 (2·v0/g) — задаём как life, чтобы фейд
      // (lk→1) совпадал с приземлением (h→0), см. buildMaterial().
      const life = (2 * v0) / EJECTA_GRAVITY;
      const dark = rnd() < 0.25 ? 1 : 0; // доля тёмных обломков породы
      const size = dark ? 0.02 + rnd() * 0.02 : 0.012 + rnd() * 0.016;

      this.writeParticle(
        now,
        life,
        Math.min(0.15, life * 0.2),
        angle,
        v0,
        rSpeed,
        dark,
        size,
        dir.x,
        dir.y,
        dir.z,
      );
    }

    this.flush();
  }

  // Заливает изменённые атрибуты на GPU одним махом (только если что-то писали).
  private flush(): void {
    if (!this.dirty) return;
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
    this.attrC.needsUpdate = true;
    this.dirty = false;
  }
}
