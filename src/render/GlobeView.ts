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
  vec4,
  vec3,
  float,
  clamp,
  mix,
  smoothstep,
  texture,
  uv,
  positionLocal,
  normalLocal,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { EARTH_TOPO_URL, GLOBE_LON_SEG, GLOBE_LAT_SEG, MAX_CRATER_DEPTH } from '../assets/config';
import { buildBiomeCanvas } from './MaterialGlobe';

const ATMOSPHERE_RADIUS = 1.06;
const ATMOSPHERE_FRESNEL_POWER = 4.5;
const ATMOSPHERE_INTENSITY = 0.55;

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

    // Поле урона (Task 7): R=глубина воронки, G=гарь, B=оплавление/полынья.
    const dmg = texture(damageTex, uv());
    const depth = dmg.r;
    // Вдавливание воронки: сдвиг вершины внутрь вдоль нормали. Обязательно локальные
    // position/normal (не world) — сфера описана в объектных координатах.
    earthMaterial.positionNode = positionLocal.sub(
      normalLocal.mul(depth.mul(float(MAX_CRATER_DEPTH))),
    );

    // Перекраска: биом-цвет → копоть по каналу G → полынья по каналу B (Task 11).
    const base = texture(biomeTex, uv()).rgb;
    const charred = mix(base, vec3(0.06, 0.05, 0.05), clamp(dmg.g, 0, 1));
    // Профиль B — «чаша»: максимум в центре воронки, спад к краю пятна. Поэтому цвет полыньи
    // задаём двумя порогами по возрастанию B: сперва суша светлеет до битого льда (кайма),
    // затем в центре (где B выше всего) темнеет до открытой воды.
    const iceRim = smoothstep(0.15, 0.4, dmg.b); // 0..1: суша → светлая ледяная крошка
    const openWater = smoothstep(0.45, 0.75, dmg.b); // 0..1: кайма льда → тёмная вода в центре
    const withIceRim = mix(charred, vec3(0.7, 0.78, 0.85), iceRim);
    const molten = mix(withIceRim, vec3(0.05, 0.12, 0.2), openWater);
    earthMaterial.colorNode = molten;

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
