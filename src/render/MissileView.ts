// Процедурная модель МБР в пуле: порт buildMissileModel()/spawnMissile() из
// reference/earth-nuke.html (~672-720). Пул из POOL_SIZE моделей создаётся один раз в
// конструкторе — после прогрева spawn()/update() не создают геометрию/материалы/векторы,
// только переиспользуют то, что уже лежит в слотах.
import type * as THREE from 'three/webgpu';
import { uniform, attribute, float, vec3, smoothstep, lessThan, select, clamp } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { ballisticPosInto } from '../sim/ballistics';
import { findFreeSlotIndex } from './SlotPool';
import { TRAIL_SEGMENTS, TRAIL_FADE_T, TRAIL_COLOR } from '../assets/config';

// Точный тип float-юниформа (как в MagmaCore): .value — number.
function makeFloatUniform(v: number) {
  return uniform(v);
}
type FloatUniform = ReturnType<typeof makeFloatUniform>;

// 16, а не 8: при flightTime=2.6с и отсутствии дебаунса ввода/лимита боеголовок в симуляции
// быстрым кликаньем реально одновременно поднять больше 8 ракет. Запас вместимости —
// дешёвый способ сделать исчерпание пула практически недостижимым при обычной игре, оставляя
// graceful no-op (см. spawn()) как страховку на случай экстремального спама.
// 24 (было 16): слот теперь занят и ПОСЛЕ детонации баллистической ракеты — пока тает её
// след (TRAIL_FADE_T) — залп 6 ракет × (полёт до 8с + фейд 5с) держит слоты дольше.
const POOL_SIZE = 24;
const START_RADIUS = 2.6;
const END_RADIUS = 1.0;
const MODEL_SPIN_SPEED = 1.5; // рад/с вращения корпуса вокруг собственной оси
const FLAME_BASE_SCALE = 0.8;
const FLAME_JITTER = 0.45; // амплитуда дрожания факела (Math.random разрешён в рендере)

interface MissileSlot {
  readonly group: THREE.Group; // добавлен в spinGroup один раз; позиционируется вдоль dir
  readonly model: THREE.Group; // корпус ракеты (вращается вокруг z во время полёта)
  readonly flame: THREE.Mesh; // факел двигателя (дрожание масштаба по Y)
  readonly dir: THREE.Vector3; // переиспользуемый вектор направления — без аллокаций в update
  readonly center: THREE.Vector3; // переиспользуемый вектор-скрэтч для lookAt
  // Баллистический режим (спека 2026-07-14): plain-векторы под ballisticPosInto — без аллокаций.
  readonly fromP: Vec3;
  readonly toP: Vec3;
  readonly posP: Vec3;
  // След МБР (ревизия §5): дуга траектории, заполняется один раз при пуске; в кадре — юниформы.
  readonly trailLine: THREE.Line;
  readonly trailPos: THREE.BufferAttribute;
  readonly uHead: FloatUniform; // прогресс полёта — видимая часть дуги (позади ракеты)
  readonly uFade: FloatUniform; // затухание следа после детонации 1→0
  hasTrail: boolean;
  fading: boolean; // ракета отлетела, слот занят тающим следом
  fadeT: number;
  ballistic: boolean; // false — прежний «удар из космоса» (радиальный спуск)
  flightTime: number; // сек; приходит из события missileLaunched (sim авторитетен)
  active: boolean;
  id: number;
  yieldMt: number;
  t: number;
}

export class MissileView {
  private readonly slots: MissileSlot[] = [];
  private poolExhaustedWarned = false; // чтобы не спамить console.warn каждый кадр спама

  constructor(
    private readonly ctx: ThreeCtx,
    private readonly spinGroup: THREE.Group,
  ) {
    for (let i = 0; i < POOL_SIZE; i++) this.slots.push(this.createSlot());
  }

  private createSlot(): MissileSlot {
    const { THREE } = this.ctx;
    const group = new THREE.Group();
    group.visible = false;
    const { model, flame } = this.buildMissileModel();
    group.add(model);
    this.spinGroup.add(group);
    const { trailLine, trailPos, uHead, uFade } = this.buildTrail();
    return {
      group,
      model,
      flame,
      dir: new THREE.Vector3(),
      center: new THREE.Vector3(),
      fromP: { x: 0, y: 0, z: 0 },
      toP: { x: 0, y: 0, z: 0 },
      posP: { x: 0, y: 0, z: 0 },
      trailLine,
      trailPos,
      uHead,
      uFade,
      hasTrail: false,
      fading: false,
      fadeT: 0,
      ballistic: false,
      flightTime: 2.6,
      active: false,
      id: -1,
      yieldMt: 0,
      t: 0,
    };
  }

  // След МБР: линия из TRAIL_SEGMENTS+1 вершин с атрибутом aArc (0..1 вдоль дуги). Видна часть
  // позади ракеты (aArc < uHead), ярче у головы; после детонации весь след гасится uFade.
  // Позиции заполняются один раз при spawn — в кадре меняются только юниформы.
  private buildTrail(): {
    trailLine: THREE.Line;
    trailPos: THREE.BufferAttribute;
    uHead: FloatUniform;
    uFade: FloatUniform;
  } {
    const { THREE } = this.ctx;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((TRAIL_SEGMENTS + 1) * 3);
    const arc = new Float32Array(TRAIL_SEGMENTS + 1);
    for (let i = 0; i <= TRAIL_SEGMENTS; i++) arc[i] = i / TRAIL_SEGMENTS;
    const trailPos = new THREE.BufferAttribute(positions, 3);
    trailPos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', trailPos);
    geo.setAttribute('aArc', new THREE.BufferAttribute(arc, 1));

    const uHead = makeFloatUniform(0);
    const uFade = makeFloatUniform(1);
    const a = attribute<'float'>('aArc', 'float');
    const behind = select(lessThan(a, uHead), float(1), float(0));
    const bright = float(0.35).add(smoothstep(uHead.sub(0.12), uHead, a).mul(0.65));
    const mat = new THREE.LineBasicNodeMaterial();
    mat.colorNode = vec3(TRAIL_COLOR[0], TRAIL_COLOR[1], TRAIL_COLOR[2]);
    mat.opacityNode = clamp(behind.mul(bright).mul(uFade), 0, 1);
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;

    const trailLine = new THREE.Line(geo, mat);
    trailLine.visible = false;
    trailLine.frustumCulled = false;
    this.spinGroup.add(trailLine);
    return { trailLine, trailPos, uHead, uFade };
  }

  // Порт buildMissileModel() эталона (~643-674): боеголовка, вторая ступень, межступенчатое
  // кольцо, первая ступень, сопло, 4 стабилизатора, факел. Модель собрана вдоль +z (нос к цели).
  private buildMissileModel(): { model: THREE.Group; flame: THREE.Mesh } {
    const { THREE } = this.ctx;
    const model = new THREE.Group();
    const white = new THREE.MeshPhongNodeMaterial({
      color: 0xf0f0f0,
      shininess: 70,
      specular: 0x666666,
    });
    const dark = new THREE.MeshPhongNodeMaterial({
      color: 0x1c1c1e,
      shininess: 30,
      specular: 0x333333,
    });
    const grey = new THREE.MeshPhongNodeMaterial({
      color: 0xb9bec4,
      shininess: 40,
      specular: 0x444444,
    });

    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      z: number,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = z;
      model.add(mesh);
      return mesh;
    };

    add(new THREE.ConeGeometry(0.0062, 0.02, 24), dark, 0.035); // боеголовка
    add(new THREE.CylinderGeometry(0.0062, 0.0062, 0.032, 24), white, 0.009); // вторая ступень
    add(new THREE.CylinderGeometry(0.0064, 0.0064, 0.005, 24), dark, -0.009); // межступенчатое кольцо
    add(new THREE.CylinderGeometry(0.0068, 0.0068, 0.034, 24), grey, -0.028); // первая ступень
    add(new THREE.CylinderGeometry(0.003, 0.0058, 0.008, 24), dark, -0.048); // сопло

    for (let i = 0; i < 4; i++) {
      // стабилизаторы
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.011, 0.016), dark);
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      fin.position.set(Math.cos(a) * 0.009, Math.sin(a) * 0.009, -0.038);
      fin.rotation.z = a - Math.PI / 2;
      model.add(fin);
    }

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.0052, 0.035, 16),
      new THREE.MeshBasicNodeMaterial({
        color: 0xffb050,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flame.rotation.x = -Math.PI / 2; // остриё факела назад
    flame.position.z = -0.066;
    model.add(flame);

    return { model, flame };
  }

  // Свободный слот пула через чистую findFreeSlotIndex (test/render/SlotPool.test.ts),
  // либо undefined, если все POOL_SIZE слотов заняты. Никогда не крадёт чужой активный слот.
  private acquireSlot(): MissileSlot | undefined {
    const idx = findFreeSlotIndex(this.slots);
    return idx === undefined ? undefined : this.slots[idx];
  }

  // Активирует слот пула для боеголовки id, летящей в направлении dir (единичный вектор,
  // локальные координаты spinGroup). yieldMt визуал пока не использует (масштаб/цвет факела
  // по мощности — Task 9-10), но сохраняется на слоте на будущее.
  //
  // Если пул исчерпан (все POOL_SIZE слотов заняты) — graceful no-op: не активирует ракету,
  // не трогает чужие слоты. Симуляция авторитетна и всё равно посчитает взрыв/жертв по своему
  // таймеру (despawn() на explosionStarted просто не найдёт слот с этим id — а он и не найдёт
  // ни у кого чужого, т.к. слот не был украден); в редком экстремальном спаме одна ракета
  // визуально не появится, но ничего не ломается и не пропадает "неправильно".
  // from — точка старта на поверхности: задана → баллистическая дуга (МБР), нет → прежний
  // «удар из космоса». flightTime приходит из события missileLaunched (sim авторитетен —
  // хардкод-дубль константы 2.6 из рендера устранён).
  spawn(id: number, dir: Vec3, yieldMt: number, flightTime: number, from?: Vec3): void {
    const slot = this.acquireSlot();
    if (!slot) {
      if (!this.poolExhaustedWarned) {
        this.poolExhaustedWarned = true;
        console.warn(
          `MissileView: пул из ${POOL_SIZE} слотов исчерпан, ракета id=${id} не отрисована (sim продолжает считать её штатно)`,
        );
      }
      return;
    }

    slot.active = true;
    slot.id = id;
    slot.yieldMt = yieldMt;
    slot.t = 0;
    slot.flightTime = flightTime;
    slot.ballistic = !!from;
    slot.dir.set(dir.x, dir.y, dir.z);
    slot.model.rotation.z = 0;
    slot.flame.scale.y = 1;
    slot.fading = false;
    slot.hasTrail = !!from;
    slot.trailLine.visible = false;

    if (from) {
      // Заполняем дугу следа ОДИН РАЗ (позиции всей траектории); в полёте меняется лишь uHead.
      const arr = slot.trailPos.array as Float32Array;
      for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
        ballisticPosInto(from, dir, i / TRAIL_SEGMENTS, slot.posP);
        arr[i * 3] = slot.posP.x;
        arr[i * 3 + 1] = slot.posP.y;
        arr[i * 3 + 2] = slot.posP.z;
      }
      slot.trailPos.needsUpdate = true;
      slot.uHead.value = 0;
      slot.uFade.value = 1;
      slot.trailLine.visible = true;
    }

    if (from) {
      slot.fromP.x = from.x;
      slot.fromP.y = from.y;
      slot.fromP.z = from.z;
      slot.toP.x = dir.x;
      slot.toP.y = dir.y;
      slot.toP.z = dir.z;
      slot.group.position.set(from.x, from.y, from.z);
      // Нос — вертикально вверх со старта (буст); по траектории развернёт первый update.
      slot.center.set(from.x * 2, from.y * 2, from.z * 2);
      slot.group.lookAt(this.spinGroup.localToWorld(slot.center));
    } else {
      slot.group.position.copy(slot.dir).multiplyScalar(START_RADIUS);
      slot.center.set(0, 0, 0);
      slot.group.lookAt(this.spinGroup.localToWorld(slot.center));
    }
    slot.group.visible = true;
  }

  // Прячет слот боеголовки id обратно в пул немедленно (вызывается на explosionStarted —
  // авторитетный сигнал симуляции о конце полёта). Не аллоцирует и безопасно вызывается
  // повторно/для уже неактивного id.
  despawn(id: number): void {
    for (const slot of this.slots) {
      if (slot.active && slot.id === id) {
        this.finishFlight(slot);
      }
    }
  }

  // Конец полёта: ракета прячется; слот со следом остаётся занят фазой fading (след тает
  // TRAIL_FADE_T сек), без следа — освобождается сразу (прежнее поведение «из космоса»).
  private finishFlight(slot: MissileSlot): void {
    slot.group.visible = false;
    if (slot.hasTrail && !slot.fading) {
      slot.fading = true;
      slot.fadeT = TRAIL_FADE_T;
      slot.uHead.value = 1.01; // вся дуга видима, пока тает
    } else if (!slot.hasTrail) {
      slot.active = false;
    }
  }

  // Немедленно прячет все ракеты и следы (planetReset).
  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.fading = false;
      slot.group.visible = false;
      slot.trailLine.visible = false;
    }
  }

  // Двигает активные снаряды: «из космоса» — радиальный спуск 2.6→1.0 (по k*k — разгон к
  // поверхности), баллистические — дуга ballisticPosInto (slerp+апогей, нос по касательной:
  // lookAt точки чуть впереди по траектории). Крутит корпус/дрожит факелом. Локальный таймер —
  // запасной путь скрытия слота на случай, если explosionStarted не пришёл вовремя
  // (рассинхрон таймингов); при штатной работе despawn() срабатывает раньше.
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;

      // Тающий след после детонации: слот занят, но ракета уже не летит.
      if (slot.fading) {
        slot.fadeT -= dt;
        slot.uFade.value = Math.max(0, slot.fadeT / TRAIL_FADE_T);
        if (slot.fadeT <= 0) {
          slot.active = false;
          slot.fading = false;
          slot.trailLine.visible = false;
        }
        continue;
      }

      slot.t += dt;
      const k = Math.min(1, slot.t / slot.flightTime);
      if (slot.ballistic) {
        slot.uHead.value = k;
        ballisticPosInto(slot.fromP, slot.toP, k, slot.posP);
        slot.group.position.set(slot.posP.x, slot.posP.y, slot.posP.z);
        const ka = Math.min(1, k + 0.02);
        if (ka > k) {
          ballisticPosInto(slot.fromP, slot.toP, ka, slot.posP);
          slot.center.set(slot.posP.x, slot.posP.y, slot.posP.z);
          slot.group.lookAt(this.spinGroup.localToWorld(slot.center));
        }
      } else {
        const dist = START_RADIUS - (START_RADIUS - END_RADIUS) * k * k;
        slot.group.position.copy(slot.dir).multiplyScalar(dist);
        slot.center.set(0, 0, 0);
        slot.group.lookAt(this.spinGroup.localToWorld(slot.center));
      }
      slot.model.rotation.z += dt * MODEL_SPIN_SPEED;
      slot.flame.scale.y = FLAME_BASE_SCALE + Math.random() * FLAME_JITTER;

      if (k >= 1) this.finishFlight(slot);
    }
  }
}
