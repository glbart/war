// Глобус + атмосфера: порт из reference/earth-nuke.html (строки ~101-201, шейдер атмосферы ~118-140).
// В отличие от эталона атмосфера не ShaderMaterial с GLSL, а TSL-узлы MeshBasicNodeMaterial
// (WebGPU-бэкенд three 0.185 компилирует их и в WGSL, и в GLSL-фолбэк).
import type * as THREE from 'three/webgpu';
import {
  positionWorld,
  cameraPosition,
  normalWorld,
  dot,
  sub,
  normalize,
  pow,
  oneMinus,
  abs,
  vec3,
  vec4,
  float,
  clamp,
  mix,
  smoothstep,
  texture,
  uv,
  uniform,
  positionLocal,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import {
  EARTH_TOPO_URL,
  GLOBE_LON_SEG,
  GLOBE_LAT_SEG,
  CRATER_MATERIAL_COLORS,
} from '../assets/config';
import { buildBiomeCanvas } from './MaterialGlobe';
import { crackEmissiveNode, setEmissiveNode } from './effects/cracks';

// Точный тип float-юниформа (как в MagmaCore): .value — number, а не объединение перегрузок.
function makeFloatUniform(v: number) {
  return uniform(v);
}

const ATMOSPHERE_RADIUS = 1.06;
const ATMOSPHERE_FRESNEL_POWER = 4.5;
const ATMOSPHERE_INTENSITY = 0.55;

export class GlobeView {
  readonly earthMesh: THREE.Mesh;
  readonly spinGroup: THREE.Group; // вращение вокруг Y (drag по горизонтали)
  readonly tiltGroup: THREE.Group; // наклон вокруг X (drag по вертикали)
  readonly biomeTexture: THREE.Texture; // отдаётся наружу — используется CrustView для окраски грунта

  private readonly readyPromise: Promise<void>;
  private readonly uTime = makeFloatUniform(0); // часы пульса трещин (толкает Scene.update)
  private readonly uCrackBoost = makeFloatUniform(0); // глобальный буст трещин (агония раскола)
  private readonly atmoMesh: THREE.Mesh; // атмосфера — прячется вместе с глобусом при расколе

  constructor(ctx: ThreeCtx, damageTex: THREE.Texture, holeTex: THREE.Texture) {
    const { THREE } = ctx;

    const earthMaterial = new THREE.MeshPhongNodeMaterial({ shininess: 12, specular: 0x223344 });

    // Биом-текстура строится синхронно (нужна сразу для colorNode материала); карта рельефа
    // (bump) грузится отдельно и асинхронно в loadTexture() и на геометрию/цвет не влияет.
    const biomeTex = new THREE.CanvasTexture(buildBiomeCanvas());
    biomeTex.colorSpace = THREE.SRGBColorSpace;
    biomeTex.anisotropy = ctx.renderer.getMaxAnisotropy();
    this.biomeTexture = biomeTex;

    // Поле урона: R=очаги трещин (этап 3, эмиссия ниже), G=гарь-градиент (широкий),
    // B=оплавление/полынья (лёд). A (вал+эжекта) не читается — морфология кратера переехала в
    // воксельную кору (CrustView), деформация сферы и её кратерный микрорельеф демонтированы.
    const dmg = texture(damageTex, uv());

    // Перекраска: база — биом; поверх — гарь (G) и полынья льда (B). Зоны выброса/породы/стекла
    // (были по R/A) убраны вместе с деформацией — их теперь рисует CrustView по глубине карва.
    const cm = CRATER_MATERIAL_COLORS;
    const base = texture(biomeTex, uv()).rgb;
    // гарь — мягкое потемнение биома градиентом по G (морфология кратера — воксельная кора)
    const scorched = mix(
      base,
      vec3(cm.scorch[0], cm.scorch[1], cm.scorch[2]),
      clamp(dmg.g.mul(0.8), 0, 1),
    );
    // лёд-полынья (B): светлая ледяная крошка → тёмная открытая вода в центре
    const iceRim = smoothstep(0.15, 0.4, dmg.b);
    const openWater = smoothstep(0.45, 0.75, dmg.b);
    const withIceRim = mix(scorched, vec3(0.7, 0.78, 0.85), iceRim);
    earthMaterial.colorNode = mix(withIceRim, vec3(0.05, 0.12, 0.2), openWater);

    // Светящиеся трещины глубоких очагов (R поля урона) — эмиссивно, поверх гари (этап 3).
    setEmissiveNode(
      earthMaterial,
      crackEmissiveNode(dmg.r, normalize(positionLocal), this.uTime, this.uCrackBoost),
    );

    // Дырки коры: там, где HoleMask=1, фрагмент глобуса отбрасывается (регион рисует CrustView).
    // alphaTest-путь node-материалов делает discard без transparent-прохода.
    earthMaterial.opacityNode = oneMinus(texture(holeTex, uv()).r);
    earthMaterial.alphaTest = 0.5;

    this.tiltGroup = new THREE.Group();
    this.spinGroup = new THREE.Group();
    this.tiltGroup.add(this.spinGroup);
    ctx.scene.add(this.tiltGroup);

    this.earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, GLOBE_LON_SEG, GLOBE_LAT_SEG),
      earthMaterial,
    );
    this.spinGroup.add(this.earthMesh);

    this.atmoMesh = this.buildAtmosphere(ctx);
    this.spinGroup.add(this.atmoMesh);

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

  // Часы шейдера трещин (пульс) — толкает Scene.update раз за кадр.
  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Глобальный буст трещин (агония раскола, этап 4) — гонит Scene.update.
  setCrackBoost(v: number): void {
    this.uCrackBoost.value = v;
  }

  // Раскол: глобус и атмосфера скрываются (магма-ядро и осколки — забота Scene).
  setPlanetVisible(v: boolean): void {
    this.earthMesh.visible = v;
    this.atmoMesh.visible = v;
  }

  // Резолвится сразу же (биом-текстура и узлы материала готовы синхронно в конструкторе);
  // оставлено для совместимости вызова в main.ts (await до включения управления камерой).
  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}
