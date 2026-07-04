// Кратеры-декали + остывающая раскалённая кайма поверх тайлов (порт reference/earth-nuke.html:
// orthoBasis/makePatchGeometry ~452-492, makeCraterTexture ~526-558, updateGlows ~566-581).
// Кратер и кайма — изогнутые "нашлёпки" на сфере (patch-геометрия вокруг нормали эпицентра),
// а не проекционные decal-объёмы — так же, как в эталоне.
//
// Пул на MAX_CRATERS слотов: слоты заводятся лениво по мере поступления взрывов, а после
// заполнения самый старый слот переиспользуется (RingCursor, вынесенный в DecalPool.ts ради
// юнит-тестируемости без three.js). У кратера и каймы РАЗНАЯ геометрия на каждый spawn
// (уникальная ориентация/поворот), поэтому, в отличие от ExplosionView/MissileView, геометрию
// нельзя построить один раз в конструкторе — она создаётся заново при каждом (пере)использовании
// слота, старая же явно disposed(). Материал кратера, наоборот, ОДИН из трёх статичных вариантов
// текстуры (переиспользуется всеми слотами — как craterTexes в эталоне); материал каймы —
// per-slot (у каждой активной каймы свой независимо остывающий цвет/прозрачность).
//
// Никакого динамического света: раскалённая кайма — additive-декаль, а не PointLight.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import type { GlobeView } from './GlobeView';
import type { Vec3 } from '../sim/geo';
import { RingCursor } from './DecalPool';

const MAX_CRATERS = 512;
const PATCH_SEG = 12; // сетка патча (порт makePatchGeometry, SEG=12)
const CRATER_R = 1.0032;
const GLOW_R = 1.0036;
const GLOW_ANG_SCALE = 1.15; // кайма чуть шире кратера (порт detonate() ~744)
const GLOW_LIFETIME = 50; // секунд до полного остывания каймы (порт updateGlows, age > 50)
const SOFT_TEX_SIZE = 64;
const CRATER_TEX_SIZE = 256;
const CRATER_TEX_SEEDS = [11, 77, 211]; // порт craterTexes ~559

// Полуугол кратера по мощности заряда, радианы (порт angPatch из detonate() ~730).
const ANG_PATCH_BY_YIELD: Record<number, number> = { 1: 0.05, 10: 0.082, 100: 0.14 };
const DEFAULT_ANG_PATCH = 0.082; // = ANG_PATCH_BY_YIELD[10] — литерал, чтобы не тянуть за собой
// `| undefined` от noUncheckedIndexedAccess в собственный фолбэк ANG_PATCH_BY_YIELD[yieldMt] ?? ...

interface DecalSlot {
  readonly craterMesh: THREE.Mesh;
  readonly glowMesh: THREE.Mesh;
  readonly glowMaterial: THREE.MeshBasicNodeMaterial;
  glowAge: number;
  glowDone: boolean; // true — кайма уже полностью остыла (или слот ещё не использовался)
}

// Простой детерминированный LCG (тот же алгоритм, что makeCraterTexture ~532 и spawnMissile-
// эффекты в других вьюхах): по seed взрыва даёт стабильные между запусками поворот патча
// и выбор текстуры кратера, вместо Math.random() эталона (там ориентация не была связана
// с seed'ом взрыва — здесь мы делаем её воспроизводимой, раз seed уже есть в сигнатуре).
function seededRandom(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export class DecalView {
  private readonly slots: DecalSlot[] = [];
  private readonly cursor = new RingCursor(MAX_CRATERS);
  private readonly craterMaterials: THREE.MeshLambertNodeMaterial[];
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
    this.craterMaterials = CRATER_TEX_SEEDS.map(
      (seed) =>
        new THREE.MeshLambertNodeMaterial({
          map: this.makeCraterTexture(seed),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
  }

  // Касательный базис из нормали (порт orthoBasis ~452-457) — идентичен использованному
  // в ExplosionView для купола ударной волны, но патч кратера плоский (не купол), поэтому
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
  // (порт makePatchGeometry ~461-492). Используется и для кратера, и для каймы — как в эталоне.
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

  // Радиальная текстура кратера с рытвинами-пятнами вокруг (порт makeCraterTexture ~526-558).
  private makeCraterTexture(seed: number): THREE.CanvasTexture {
    const { THREE } = this.ctx;
    const S = CRATER_TEX_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const c2d = canvas.getContext('2d')!;
    const rnd = seededRandom(seed);
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.36;

    const g = c2d.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, 'rgba(14, 10, 8, 0.98)');
    g.addColorStop(0.5, 'rgba(36, 25, 17, 0.88)');
    g.addColorStop(0.78, 'rgba(58, 40, 26, 0.5)');
    g.addColorStop(1, 'rgba(58, 40, 26, 0)');
    c2d.fillStyle = g;
    c2d.beginPath();
    c2d.arc(cx, cy, R, 0, Math.PI * 2);
    c2d.fill();

    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const d = R * (0.55 + rnd() * 0.6);
      const br = R * (0.1 + rnd() * 0.22);
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d;
      const gg = c2d.createRadialGradient(bx, by, 0, bx, by, br);
      const al = 0.25 + rnd() * 0.35;
      gg.addColorStop(0, `rgba(30, 21, 14, ${al})`);
      gg.addColorStop(1, 'rgba(30, 21, 14, 0)');
      c2d.fillStyle = gg;
      c2d.beginPath();
      c2d.arc(bx, by, br, 0, Math.PI * 2);
      c2d.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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
    const craterMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.craterMaterials[0]);
    craterMesh.renderOrder = 1;
    craterMesh.visible = false;
    craterMesh.frustumCulled = false;
    this.globe.spinGroup.add(craterMesh);

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

    return { craterMesh, glowMesh, glowMaterial, glowAge: 0, glowDone: true };
  }

  // Заводит постоянный кратер + свежую раскалённую кайму в точке dir (единичная нормаль,
  // локальные координаты globe.spinGroup). Пул растёт лениво до MAX_CRATERS, затем каждый
  // новый взрыв переиспользует слот самого старого кратера (RingCursor.next()).
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
    const texIdx = Math.floor(rnd() * this.craterMaterials.length) % this.craterMaterials.length;
    const angPatch = ANG_PATCH_BY_YIELD[yieldMt] ?? DEFAULT_ANG_PATCH;

    slot.craterMesh.geometry.dispose();
    slot.craterMesh.geometry = this.makePatchGeometry(n, angPatch, CRATER_R, rot);
    slot.craterMesh.material = this.craterMaterials[texIdx]!; // texIdx < craterMaterials.length по построению
    slot.craterMesh.visible = true;

    slot.glowMesh.geometry.dispose();
    slot.glowMesh.geometry = this.makePatchGeometry(n, angPatch * GLOW_ANG_SCALE, GLOW_R, rot);
    slot.glowMesh.visible = true;
    slot.glowMaterial.opacity = 0.95;
    slot.glowMaterial.color.copy(this.glowColorHot);
    slot.glowAge = 0;
    slot.glowDone = false;
  }

  // Гонит остывание активных кайм (порт updateGlows ~566-581): opacity падает по
  // (1 - age/50)^1.6, цвет линейно идёт hot→cold за первые 25с. Кратеры сами по себе
  // постоянны — их эта функция не трогает (остывает только кайма).
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

  // Прячет все кратеры/каймы (planetReset). Геометрии не освобождаем сразу — их всё равно
  // dispose()+пересоздаст следующий spawn() в этот слот; пул перезапускается с индекса 0
  // (cursor.reset()), чтобы заполнение шло в прежнем порядке.
  clear(): void {
    for (const slot of this.slots) {
      slot.craterMesh.visible = false;
      slot.glowMesh.visible = false;
      slot.glowMaterial.opacity = 0;
      slot.glowDone = true;
      slot.glowAge = 0;
    }
    this.cursor.reset();
  }
}
