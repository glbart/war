// Глобус + атмосфера: порт из reference/earth-nuke.html (строки ~101-201, шейдер атмосферы ~118-140).
// В отличие от эталона атмосфера не ShaderMaterial с GLSL, а TSL-узлы MeshBasicNodeMaterial
// (WebGPU-бэкенд three 0.185 компилирует их и в WGSL, и в GLSL-фолбэк).
import type * as THREE from 'three/webgpu';
import {
  Fn,
  positionWorld,
  cameraPosition,
  normalWorld,
  dot,
  cross,
  sub,
  normalize,
  pow,
  oneMinus,
  abs,
  vec3,
  vec4,
  float,
  floor,
  fract,
  clamp,
  mix,
  smoothstep,
  select,
  lessThan,
  texture,
  uv,
  positionLocal,
  normalLocal,
  materialNormal,
  transformNormalToView,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import {
  EARTH_TOPO_URL,
  GLOBE_LON_SEG,
  GLOBE_LAT_SEG,
  MAX_CRATER_DEPTH,
  CRATER_RIM_HEIGHT,
  CRATER_MATERIAL_COLORS,
  CRATER_DETAIL_OCTAVES,
  CRATER_DETAIL_STRENGTH,
} from '../assets/config';
import { buildBiomeCanvas } from './MaterialGlobe';

const ATMOSPHERE_RADIUS = 1.06;
const ATMOSPHERE_FRESNEL_POWER = 4.5;
const ATMOSPHERE_INTENSITY = 0.55;

// Микрорельеф кратера: масштаб шума по сфере, шаг конечных разностей для нормали и сила рельефа.
const DETAIL_FREQ = 46.0; // частота fbm по positionLocal (мелкая шероховатость вала/стенок)
const DETAIL_EPS = 0.0018; // шаг конечных разностей в касательной плоскости
const DETAIL_RELIEF = 0.5; // масштаб наклона нормали от градиента высоты

// Узловые типы для аргументов TSL-функций (Fn), как в OceanShell: тянем Node<"float">/Node<"vec3">
// из сигнатур dot/cross, чтобы не импортировать внутренний путь three к типу Node.
type FloatNode = ReturnType<typeof dot>;
type Vec3Node = ReturnType<typeof cross>;

// ---------- шум (порт hash/noise/fbm из OceanShell на TSL Fn) ----------
// value-noise на решётке хешей; fbm — CRATER_DETAIL_OCTAVES октав (микрорельеф кратера).
const hash = Fn(([p]: [Vec3Node]) => {
  const q = fract(p.mul(0.3183099).add(0.1)).mul(17.0);
  return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
});

const noise = Fn(([x]: [Vec3Node]) => {
  const i = floor(x);
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))); // сглаживание f*f*(3-2f)
  const c000 = hash(i.add(vec3(0, 0, 0)));
  const c100 = hash(i.add(vec3(1, 0, 0)));
  const c010 = hash(i.add(vec3(0, 1, 0)));
  const c110 = hash(i.add(vec3(1, 1, 0)));
  const c001 = hash(i.add(vec3(0, 0, 1)));
  const c101 = hash(i.add(vec3(1, 0, 1)));
  const c011 = hash(i.add(vec3(0, 1, 1)));
  const c111 = hash(i.add(vec3(1, 1, 1)));
  return mix(
    mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
    mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y),
    f.z,
  );
});

const fbm = Fn(([p]: [Vec3Node]) => {
  let s: FloatNode = float(0);
  let pp: Vec3Node = p;
  let a = 0.5;
  for (let k = 0; k < CRATER_DETAIL_OCTAVES; k++) {
    s = s.add(noise(pp).mul(a));
    pp = pp.mul(2.02);
    a *= 0.5;
  }
  return s;
});

// Возмущённая нормаль микрорельефа: градиент высоты fbm в касательной плоскости к n (конечные
// разности, как OceanShell.waterNormal). n — единичная локальная нормаль (≈ точка на сфере r=1).
const craterDetailNormal = Fn(([n]: [Vec3Node]) => {
  // касательный базис у n; у полюса (|n.y|≈1) берём иную опорную ось, чтобы cross не выродился
  const upRef = select(lessThan(abs(n.y), float(0.99)), vec3(0, 1, 0), vec3(1, 0, 0));
  const t1 = normalize(cross(upRef, n));
  const t2 = cross(n, t1);
  const h0 = fbm(n.mul(DETAIL_FREQ));
  const hx = fbm(normalize(n.add(t1.mul(DETAIL_EPS))).mul(DETAIL_FREQ));
  const hy = fbm(normalize(n.add(t2.mul(DETAIL_EPS))).mul(DETAIL_FREQ));
  const grad = t1
    .mul(hx.sub(h0))
    .add(t2.mul(hy.sub(h0)))
    .mul(DETAIL_RELIEF / DETAIL_EPS);
  return normalize(n.sub(grad));
});

export class GlobeView {
  readonly earthMesh: THREE.Mesh;
  readonly spinGroup: THREE.Group; // вращение вокруг Y (drag по горизонтали)
  readonly tiltGroup: THREE.Group; // наклон вокруг X (drag по вертикали)

  private readonly readyPromise: Promise<void>;

  constructor(ctx: ThreeCtx, damageTex: THREE.Texture) {
    const { THREE } = ctx;

    const earthMaterial = new THREE.MeshPhongNodeMaterial({ shininess: 12, specular: 0x223344 });

    // Биом-текстура строится синхронно (нужна сразу для colorNode материала); карта рельефа
    // (bump) грузится отдельно и асинхронно в loadTexture() и на геометрию/цвет не влияет.
    const biomeTex = new THREE.CanvasTexture(buildBiomeCanvas());
    biomeTex.colorSpace = THREE.SRGBColorSpace;
    biomeTex.anisotropy = ctx.renderer.getMaxAnisotropy();

    // Поле урона (Task 1, 2A): R=глубина чаши (вниз), G=гарь-градиент (широкий), B=оплавление/
    // полынья (лёд), A=вал+эжекта (вверх, кольцо снаружи чаши). Захват — один раз.
    const dmg = texture(damageTex, uv());
    const depth = dmg.r;
    // Деформация: дно чаши вдавлено вдоль нормали на R·MAX_CRATER_DEPTH, вал/эжекта приподняты на
    // A·CRATER_RIM_HEIGHT. Обязательно локальные position/normal — сфера в объектных координатах.
    const rimUp = dmg.a.mul(float(CRATER_RIM_HEIGHT));
    earthMaterial.positionNode = positionLocal
      .sub(normalLocal.mul(depth.mul(float(MAX_CRATER_DEPTH))))
      .add(normalLocal.mul(rimUp));

    // Перекраска: зоны материала кратера по возрастанию «жёсткости» к центру (вместо одной чёрной
    // гари). База — биом; поверх — послойные mix'ы по каналам поля урона.
    const cm = CRATER_MATERIAL_COLORS;
    const base = texture(biomeTex, uv()).rgb;
    // 1) широкая гарь — мягкое потемнение биома ГРАДИЕНТОМ по каналу G (не слэб near-black):
    const scorched = mix(
      base,
      vec3(cm.scorch[0], cm.scorch[1], cm.scorch[2]),
      clamp(dmg.g.mul(0.8), 0, 1),
    );
    // 2) выброс/пыль на кольце вала (A) — присыпка светлее биома:
    const dusted = mix(
      scorched,
      vec3(cm.dust[0], cm.dust[1], cm.dust[2]),
      clamp(dmg.a.mul(0.6), 0, 1),
    );
    // 3) обнажённая порода на склоне чаши (средний R; гаснет к центру, где уже стекло):
    const rockMask = clamp(dmg.r.mul(1.6), 0, 1).mul(oneMinus(smoothstep(0.7, 1.0, dmg.r)));
    const rocky = mix(dusted, vec3(cm.rock[0], cm.rock[1], cm.rock[2]), rockMask);
    // 4) оплавленное стекло в центре чаши (высокий R) — тёмное, низкосатурированное:
    const glass = mix(
      rocky,
      vec3(cm.glass[0], cm.glass[1], cm.glass[2]),
      smoothstep(0.7, 1.0, dmg.r),
    );
    // лёд-полынья (B) поверх — как раньше: профиль «чаша», два порога по возрастанию B (суша →
    // светлая ледяная крошка → тёмная открытая вода в центре).
    const iceRim = smoothstep(0.15, 0.4, dmg.b);
    const openWater = smoothstep(0.45, 0.75, dmg.b);
    const withIceRim = mix(glass, vec3(0.7, 0.78, 0.85), iceRim);
    const molten = mix(withIceRim, vec3(0.05, 0.12, 0.2), openWater);
    earthMaterial.colorNode = molten;

    // Микрорельеф нормали в damaged-зоне: возмущение геонормали процедурным fbm по positionLocal,
    // сила ∝ (R+A) — вал/стенки ловят статичный свет сцены (динсвета нет). Базовая нормаль
    // materialNormal сохраняет топо-bump вне кратера (маска≈0), внутри — подмешивается деталь.
    const detailView = transformNormalToView(craterDetailNormal(normalLocal));
    const detailMask = clamp(
      clamp(dmg.r.add(dmg.a), 0, 1).mul(float(CRATER_DETAIL_STRENGTH)),
      0,
      1,
    );
    earthMaterial.normalNode = normalize(mix(materialNormal, detailView, detailMask));

    this.tiltGroup = new THREE.Group();
    this.spinGroup = new THREE.Group();
    this.tiltGroup.add(this.spinGroup);
    ctx.scene.add(this.tiltGroup);

    this.earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, GLOBE_LON_SEG, GLOBE_LAT_SEG),
      earthMaterial,
    );
    this.spinGroup.add(this.earthMesh);

    this.spinGroup.add(this.buildAtmosphere(ctx));

    this.readyPromise = this.loadTexture(ctx, earthMaterial);
  }

  // Атмосферное свечение — fresnel-кайма на задней стороне увеличенной сферы,
  // rim = pow(1 - |dot(N, viewDir)|, 4.5) * 0.55 (порт GLSL-шейдера эталона на TSL-узлы).
  private buildAtmosphere(ctx: ThreeCtx): THREE.Mesh {
    const { THREE } = ctx;
    const atmoMaterial = new THREE.MeshBasicNodeMaterial();

    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const rim = pow(oneMinus(abs(dot(normalWorld, viewDir))), float(ATMOSPHERE_FRESNEL_POWER)).mul(
      ATMOSPHERE_INTENSITY,
    );
    atmoMaterial.colorNode = vec4(0.35, 0.55, 1.0, 1.0).mul(rim);
    atmoMaterial.transparent = true;
    atmoMaterial.blending = THREE.AdditiveBlending;
    atmoMaterial.side = THREE.BackSide;
    atmoMaterial.depthWrite = false;

    return new THREE.Mesh(new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 64, 48), atmoMaterial);
  }

  // Биом-текстура уже подставлена в colorNode материала синхронно в конструкторе; здесь только
  // догружаем карту рельефа (bump) — не блокирует готовность колора/деформации.
  private async loadTexture(
    ctx: ThreeCtx,
    earthMaterial: THREE.MeshPhongNodeMaterial,
  ): Promise<void> {
    const { THREE } = ctx;
    new THREE.TextureLoader().load(EARTH_TOPO_URL, (topo) => {
      earthMaterial.bumpMap = topo;
      earthMaterial.bumpScale = 0.6;
      earthMaterial.needsUpdate = true;
    });
  }

  // Резолвится сразу же (биом-текстура и узлы материала готовы синхронно в конструкторе);
  // оставлено для совместимости вызова в main.ts (await до включения управления камерой).
  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}
