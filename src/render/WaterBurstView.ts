// Подводный ядерный взрыв: купол брызг (fresnel-полусфера) + вертикальный столб воды
// (конус вдоль нормали) + пенное кольцо по поверхности (патч-геометрия с бегущим фронтом,
// как ударная волна в ExplosionView). Пул слотов, таймлайн через юниформы, структура графа
// одинакова у всех слотов → один пайплайн на элемент. НИКАКОГО динамического света и
// аллокаций на кадр. В DamageField НЕ пишем — каверна смыкается, постоянного следа нет
// (в отличие от наземного взрыва, где ExplosionView дополняется DecalView/DamageField).
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
  uv,
  oneMinus,
  normalView,
  positionViewDirection,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { findFreeSlotIndex } from './SlotPool';
import { makeDomeGeometry } from './effects/geometryUtils';
import {
  YIELDS,
  YIELD_SIZE_SCALE as YS_BY_YIELD,
  YIELD_TIME_SCALE as TS_BY_YIELD,
} from '../assets/config';

// Точные типы юниформов (как в ExplosionView) — .value остаётся number, без размытых
// объединений перегрузок uniform().
function makeFloatUniform(v: number) {
  return uniform(v);
}
type FloatUniform = ReturnType<typeof makeFloatUniform>;

// Одновременных подводных взрывов немного (залпы по океану реже, чем по суше), но пул всё
// равно на POOL_SIZE слотов — простаивающие схлопнуты в scale 0 и почти ничего не стоят.
const POOL_SIZE = 8;
// Полуугол пенного кольца по мощности (радианы) — шире, чем горячая кайма DecalView, т.к.
// это расходящаяся по воде рябь/пена, а не пятно ожога.
const ANG_RING_BY_YIELD: Record<number, number> = { 1: 0.1, 10: 0.16, 100: 0.28 };

// Длительности фаз относительно ts (см. брифе Task 10): купол ~1.5·ts, столб ~2.5·ts,
// кольцо ~4·ts — самый долгий определяет, когда весь слот освобождается.
const DOME_LIFE = 1.5;
const COLUMN_LIFE = 2.5;
const RING_LIFE = 4;

interface WaterBurstSlot {
  readonly dome: THREE.Mesh;
  readonly uDomeOp: FloatUniform;
  readonly column: THREE.Mesh;
  readonly uColumnOp: FloatUniform;
  readonly ring: THREE.Mesh;
  readonly uRingR: FloatUniform;
  readonly uRingOp: FloatUniform;
  readonly dir: THREE.Vector3; // переиспользуемый вектор нормали — без аллокаций в spawn
  active: boolean;
  t: number;
  ts: number;
  ys: number;
}

export class WaterBurstView {
  private readonly slots: WaterBurstSlot[] = [];
  // Геометрия купола и столба — одна на все слоты/мощности (кривизна глобуса на масштабе
  // одного взрыва пренебрежима, поэтому размер задаём через scale, а не отдельную геометрию
  // на мощность, как для fireball в ExplosionView). Кольцо же лежит на поверхности и его
  // угловой охват должен расти с мощностью корректно по сфере — для него, как и для
  // ударной волны, геометрия строится per-yield (порт подхода ExplosionView.waveGeos).
  private readonly domeGeo: THREE.SphereGeometry;
  private readonly columnGeo: THREE.CylinderGeometry;
  private readonly ringGeos: Map<number, THREE.BufferGeometry> = new Map();
  private readonly unitY: THREE.Vector3;
  private readonly unitZ: THREE.Vector3;

  constructor(
    private readonly ctx: ThreeCtx,
    parent: THREE.Group,
  ) {
    const { THREE } = ctx;
    this.unitY = new THREE.Vector3(0, 1, 0);
    this.unitZ = new THREE.Vector3(0, 0, 1);

    // Полусфера с вершиной по +Y и плоским основанием на экваторе (y=0) — купол брызг:
    // основание садится на поверхность воды, вершина растёт вдоль нормали при quaternion
    // setFromUnitVectors(unitY, dir).
    this.domeGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);

    // Сужающийся конус вдоль +Y, основание на y=0 (сдвинут translate после построения) —
    // столб воды: узкая вершина, широкое основание у поверхности.
    this.columnGeo = new THREE.CylinderGeometry(0.06, 0.14, 1, 16, 1, false);
    this.columnGeo.translate(0, 0.5, 0);

    for (const y of YIELDS) {
      const ang = ANG_RING_BY_YIELD[y] ?? ANG_RING_BY_YIELD[10]!;
      // RS/AS=24/64 — тесселяция пенного кольца (грубее купола ударной волны ExplosionView,
      // т.к. кольцо на воде тоньше и дальше от камеры в среднем).
      this.ringGeos.set(y, makeDomeGeometry(THREE, this.unitZ, ang, 1.004, 24, 64));
    }

    for (let i = 0; i < POOL_SIZE; i++) this.slots.push(this.createSlot(parent));
  }

  private createSlot(parent: THREE.Group): WaterBurstSlot {
    const { THREE } = this.ctx;

    // Купол брызг: fresnel-ядро, как fireball в ExplosionView, но белый и мягче (меньший
    // показатель степени — брызги, а не огонь).
    const uDomeOp = makeFloatUniform(0);
    const domeMat = new THREE.MeshBasicNodeMaterial();
    const domeK = clamp(dot(normalView, positionViewDirection), 0, 1);
    const domeA = pow(domeK, 1.2);
    domeMat.colorNode = vec3(0.85, 0.92, 1.0);
    domeMat.opacityNode = domeA.mul(uDomeOp);
    domeMat.transparent = true;
    domeMat.depthWrite = false;
    domeMat.blending = THREE.AdditiveBlending;
    const dome = new THREE.Mesh(this.domeGeo, domeMat);
    dome.frustumCulled = false;
    dome.scale.setScalar(0);
    dome.renderOrder = 2;
    parent.add(dome);

    // Столб воды: продольный градиент по uv.y (ярче у основания, тает к вершине) — дешёвая
    // замена объёмному рассеиванию.
    const uColumnOp = makeFloatUniform(0);
    const columnMat = new THREE.MeshBasicNodeMaterial();
    const fade = oneMinus(uv().y).mul(0.6).add(0.4);
    columnMat.colorNode = vec3(0.88, 0.94, 1.0).mul(fade);
    columnMat.opacityNode = fade.mul(uColumnOp);
    columnMat.transparent = true;
    columnMat.depthWrite = false;
    columnMat.blending = THREE.AdditiveBlending;
    const column = new THREE.Mesh(this.columnGeo, columnMat);
    column.frustumCulled = false;
    column.scale.setScalar(0);
    column.renderOrder = 2;
    parent.add(column);

    // Пенное кольцо: бегущий фронт по угловому расстоянию — тот же приём, что ударная волна
    // в ExplosionView (front/trail по aAng), но белый/пенный цвет и медленнее гаснет.
    const uRingR = makeFloatUniform(0);
    const uRingOp = makeFloatUniform(0);
    const ringMat = new THREE.MeshBasicNodeMaterial();
    const vAng = attribute<'float'>('aAng', 'float');
    const d = vAng.sub(uRingR);
    const w = float(0.02).add(uRingR.mul(0.05));
    const x = d.div(w);
    const front = exp(x.mul(x).negate());
    const trail = select(lessThan(d, 0), exp(d.mul(7)).mul(0.35), float(0));
    ringMat.colorNode = mix(vec3(0.75, 0.85, 0.92), vec3(1.0, 1.0, 1.0), front);
    ringMat.opacityNode = front.add(trail).mul(uRingOp);
    ringMat.transparent = true;
    ringMat.depthWrite = false;
    ringMat.side = THREE.DoubleSide;
    const ring = new THREE.Mesh(this.ringGeos.get(10), ringMat);
    ring.frustumCulled = false;
    // Схлопнуто в 0, как купол/столб (по образцу ExplosionView.wave) — простаивающий слот не
    // должен занимать видимый объём даже при opacity>0 по ошибке.
    ring.scale.setScalar(0);
    ring.renderOrder = 3;
    parent.add(ring);

    return {
      dome,
      uDomeOp,
      column,
      uColumnOp,
      ring,
      uRingR,
      uRingOp,
      dir: new THREE.Vector3(),
      active: false,
      t: 0,
      ts: 1,
      ys: 1,
    };
  }

  private acquireSlot(): WaterBurstSlot | undefined {
    const idx = findFreeSlotIndex(this.slots);
    return idx === undefined ? undefined : this.slots[idx];
  }

  // Запускает подводный взрыв в точке dir (единичная нормаль, локальные координаты parent).
  // seed сейчас не влияет на форму (детерминированный эффект), сохранён ради единообразия
  // сигнатур со spawn() других вьюх.
  spawn(dir: Vec3, yieldMt: number, seed: number): void {
    void seed;
    const slot = this.acquireSlot();
    if (!slot) return; // пул исчерпан — graceful no-op, sim авторитетна

    slot.active = true;
    slot.t = 0;
    slot.ts = TS_BY_YIELD[yieldMt] ?? 1;
    slot.ys = YS_BY_YIELD[yieldMt] ?? 1;
    slot.dir.set(dir.x, dir.y, dir.z).normalize();

    // Купол — основание на поверхности, вершина растёт вдоль нормали.
    slot.dome.position.copy(slot.dir);
    slot.dome.quaternion.setFromUnitVectors(this.unitY, slot.dir);
    slot.dome.scale.setScalar(0.02);
    slot.uDomeOp.value = 1;

    // Столб — тоже основание на поверхности, вершина конуса вдоль нормали.
    slot.column.position.copy(slot.dir);
    slot.column.quaternion.setFromUnitVectors(this.unitY, slot.dir);
    slot.column.scale.set(slot.ys, 0.02, slot.ys);
    slot.uColumnOp.value = 0;

    // Кольцо — геометрия по мощности, разворот +Z→dir кватернионом (как волна в ExplosionView).
    slot.ring.geometry = this.ringGeos.get(yieldMt) ?? this.ringGeos.get(10)!;
    slot.ring.quaternion.setFromUnitVectors(this.unitZ, slot.dir);
    slot.ring.scale.setScalar(1);
    slot.uRingR.value = 0;
    slot.uRingOp.value = 0.9;
  }

  // Гонит таймлайн активных слотов через юниформы/трансформы — без аллокаций и
  // перекомпиляций шейдера. Слот живёт, пока не завершится самая долгая фаза (кольцо).
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.t += dt;
      const tt = slot.t / slot.ts;

      // Купол: быстро вспухает (первая треть жизни) и гаснет к DOME_LIFE.
      const domeGrow = Math.min(1, tt / (DOME_LIFE * 0.4));
      const domeScale = 0.02 + 0.55 * slot.ys * Math.sqrt(domeGrow);
      slot.dome.scale.setScalar(domeScale);
      slot.uDomeOp.value = Math.max(0, Math.min(1, 1.3 - tt / (DOME_LIFE * 0.8)));

      // Столб: нарастает и оседает по синусоиде за COLUMN_LIFE (плавный подъём/спад высоты).
      const columnK = Math.max(0, Math.min(1, tt / COLUMN_LIFE));
      const columnHeight = 0.02 + 0.6 * slot.ys * Math.sin(columnK * Math.PI);
      slot.column.scale.set(slot.ys, columnHeight, slot.ys);
      slot.uColumnOp.value = Math.max(0, Math.min(1, tt / 0.15)) * (1 - columnK);

      // Кольцо: фронт бежит наружу и замедляется у края, прозрачность падает вместе с ним.
      const ringK = Math.min(1, tt / RING_LIFE);
      slot.uRingR.value = 1 - Math.pow(1 - ringK, 1.8);
      slot.uRingOp.value = 0.9 * (1 - ringK);

      if (slot.t > RING_LIFE * slot.ts) {
        slot.active = false;
        slot.dome.scale.setScalar(0);
        slot.uDomeOp.value = 0;
        slot.column.scale.set(0, 0, 0);
        slot.uColumnOp.value = 0;
        slot.ring.scale.setScalar(0);
        slot.uRingOp.value = 0;
      }
    }
  }
}
