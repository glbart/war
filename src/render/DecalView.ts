// Остывающая раскалённая кайма поверх тайлов (порт reference/earth-nuke.html:
// orthoBasis/makePatchGeometry ~452-492, updateGlows ~566-581). Постоянный кратер-декаль
// (бывшая часть этого файла) вытеснен полем урона (DamageField, Task 7-9) — теперь только
// временная горячая кайма поверх места удара, а сама воронка/обугливание копится в
// equirect-текстуре поля, читаемой шейдером глобуса. Кайма — изогнутая "нашлёпка" на сфере
// (patch-геометрия вокруг нормали эпицентра), а не проекционный decal-объём — так же, как
// в эталоне.
//
// Пул на MAX_GLOWS слотов: слоты заводятся лениво по мере поступления взрывов, а после
// заполнения самый старый слот переиспользуется (RingCursor, вынесенный в DecalPool.ts ради
// юнит-тестируемости без three.js). У каймы РАЗНАЯ геометрия на каждый spawn (уникальная
// ориентация/поворот), поэтому геометрию нельзя построить один раз в конструкторе — она
// создаётся заново при каждом (пере)использовании слота, старая же явно disposed(). Материал
// каймы — per-slot (у каждой активной каймы свой независимо остывающий цвет/прозрачность).
//
// Никакого динамического света: раскалённая кайма — additive-декаль, а не PointLight.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import type { GlobeView } from './GlobeView';
import type { Vec3 } from '../sim/geo';
import { RingCursor } from './DecalPool';

const MAX_GLOWS = 512;
const PATCH_SEG = 12; // сетка патча (порт makePatchGeometry, SEG=12)
const GLOW_R = 1.0036;
const GLOW_ANG_SCALE = 1.15; // кайма чуть шире воронки поля урона (порт detonate() ~744)
const GLOW_LIFETIME = 50; // секунд до полного остывания каймы (порт updateGlows, age > 50)
const SOFT_TEX_SIZE = 64;

// Полуугол каймы по мощности заряда, радианы (порт angPatch из detonate() ~730).
const ANG_PATCH_BY_YIELD: Record<number, number> = { 1: 0.05, 10: 0.082, 100: 0.14 };
const DEFAULT_ANG_PATCH = 0.082; // = ANG_PATCH_BY_YIELD[10] — литерал, чтобы не тянуть за собой
// `| undefined` от noUncheckedIndexedAccess в собственный фолбэк ANG_PATCH_BY_YIELD[yieldMt] ?? ...

interface DecalSlot {
  readonly glowMesh: THREE.Mesh;
  readonly glowMaterial: THREE.MeshBasicNodeMaterial;
  glowAge: number;
  glowDone: boolean; // true — кайма уже полностью остыла (или слот ещё не использовался)
}

// Простой детерминированный LCG (тот же алгоритм, что и в spawn-эффектах других вьюх):
// по seed взрыва даёт стабильный между запусками поворот патча каймы, вместо Math.random()
// эталона (там ориентация не была связана с seed'ом взрыва — здесь мы делаем её
// воспроизводимой, раз seed уже есть в сигнатуре).
function seededRandom(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export class DecalView {
  private readonly slots: DecalSlot[] = [];
  private readonly cursor = new RingCursor(MAX_GLOWS);
  private readonly softTexture: THREE.CanvasTexture;
  private readonly glowColorHot: THREE.Color;
  private readonly glowColorCold: THREE.Color;

  constructor(
    private readonly ctx: ThreeCtx,
    private readonly globe: GlobeView,
  ) {
    const { THREE } = ctx;
    this.glowColorHot = new THREE.Color(0xffbb66);
    this.glowColorCold = new THREE.Color(0x661505);
    this.softTexture = this.makeSoftTexture();
  }

  // Касательный базис из нормали (порт orthoBasis ~452-457) — идентичен использованному
  // в ExplosionView для купола ударной волны, но патч каймы плоский (не купол), поэтому
  // своя копия здесь, а не общий модуль (геометрии структурно разные, делить нечего, кроме
  // этих 5 строк).
  private orthoBasis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    const { THREE } = this.ctx;
    const t1 =
      Math.abs(n.y) < 0.99
        ? new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize()
        : new THREE.Vector3(1, 0, 0);
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    return [t1, t2];
  }

  // Изогнутая "нашлёпка" на сфере вокруг нормали n, полуугол ang, радиус R, поворот rot
  // (порт makePatchGeometry ~461-492).
  private makePatchGeometry(
    n: THREE.Vector3,
    ang: number,
    R: number,
    rot: number,
  ): THREE.BufferGeometry {
    const { THREE } = this.ctx;
    const [t1, t2] = this.orthoBasis(n);
    const tanA = Math.tan(ang);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= PATCH_SEG; j++) {
      for (let i = 0; i <= PATCH_SEG; i++) {
        const gx = (i / PATCH_SEG) * 2 - 1;
        const gy = (j / PATCH_SEG) * 2 - 1;
        const rx = gx * cr - gy * sr;
        const ry = gx * sr + gy * cr;
        const p = n
          .clone()
          .addScaledVector(t1, rx * tanA)
          .addScaledVector(t2, ry * tanA)
          .normalize()
          .multiplyScalar(R);
        pos.push(p.x, p.y, p.z);
        uv.push(i / PATCH_SEG, 1 - j / PATCH_SEG);
      }
    }
    const W = PATCH_SEG + 1;
    for (let j = 0; j < PATCH_SEG; j++) {
      for (let i = 0; i < PATCH_SEG; i++) {
        const a = j * W + i;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // Мягкое белое пятно для каймы-декали (порт makeSoftTexture ~584-596 — та же текстура,
  // что softTex эталона, используемая под glow-меш).
  private makeSoftTexture(): THREE.CanvasTexture {
    const { THREE } = this.ctx;
    const S = SOFT_TEX_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const c2d = canvas.getContext('2d')!;
    const g = c2d.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c2d.fillStyle = g;
    c2d.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createSlot(): DecalSlot {
    const { THREE } = this.ctx;
    const glowMaterial = new THREE.MeshBasicNodeMaterial({
      map: this.softTexture,
      color: this.glowColorHot.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowMesh = new THREE.Mesh(new THREE.BufferGeometry(), glowMaterial);
    glowMesh.renderOrder = 2;
    glowMesh.visible = false;
    glowMesh.frustumCulled = false;
    this.globe.spinGroup.add(glowMesh);

    return { glowMesh, glowMaterial, glowAge: 0, glowDone: true };
  }

  // Заводит свежую раскалённую кайму в точке dir (единичная нормаль, локальные координаты
  // globe.spinGroup). Постоянный след (воронка/обугливание) впечатывает DamageField.splat()
  // отдельно (Scene.startExplosion) — эта вьюха отвечает только за временную кайму. Пул растёт
  // лениво до MAX_GLOWS, затем каждый новый взрыв переиспользует слот самой старой каймы
  // (RingCursor.next()).
  spawn(dir: Vec3, yieldMt: number, seed: number): void {
    const idx = this.cursor.next();
    if (idx === this.slots.length) this.slots.push(this.createSlot());
    // idx либо только что добавлен push()'ом выше, либо < this.slots.length (переиспользуемый
    // старый слот, RingCursor гарантирует idx < capacity и рост slots в лок-степе с cursor) —
    // в обоих случаях слот существует, noUncheckedIndexedAccess здесь избыточно строг.
    const slot = this.slots[idx]!;

    const { THREE } = this.ctx;
    const n = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const rnd = seededRandom(seed);
    const rot = rnd() * Math.PI * 2;
    const angPatch = ANG_PATCH_BY_YIELD[yieldMt] ?? DEFAULT_ANG_PATCH;

    slot.glowMesh.geometry.dispose();
    slot.glowMesh.geometry = this.makePatchGeometry(n, angPatch * GLOW_ANG_SCALE, GLOW_R, rot);
    slot.glowMesh.visible = true;
    slot.glowMaterial.opacity = 0.95;
    slot.glowMaterial.color.copy(this.glowColorHot);
    slot.glowAge = 0;
    slot.glowDone = false;
  }

  // Гонит остывание активных кайм (порт updateGlows ~566-581): opacity падает по
  // (1 - age/50)^1.6, цвет линейно идёт hot→cold за первые 25с.
  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.glowDone) continue;
      slot.glowAge += dt;
      if (slot.glowAge >= GLOW_LIFETIME) {
        slot.glowDone = true;
        slot.glowMaterial.opacity = 0;
        slot.glowMesh.visible = false;
        continue;
      }
      const heat = Math.pow(1 - slot.glowAge / GLOW_LIFETIME, 1.6);
      slot.glowMaterial.opacity = heat * 0.95;
      slot.glowMaterial.color.lerpColors(
        this.glowColorHot,
        this.glowColorCold,
        Math.min(1, slot.glowAge / 25),
      );
    }
  }

  // Прячет все каймы (planetReset). Постоянный след планеты чистит DamageField.clear()
  // отдельно. Геометрии не освобождаем сразу — их всё равно dispose()+пересоздаст следующий
  // spawn() в этот слот; пул перезапускается с индекса 0 (cursor.reset()), чтобы заполнение
  // шло в прежнем порядке.
  clear(): void {
    for (const slot of this.slots) {
      slot.glowMesh.visible = false;
      slot.glowMaterial.opacity = 0;
      slot.glowDone = true;
      slot.glowAge = 0;
    }
    this.cursor.reset();
  }
}
