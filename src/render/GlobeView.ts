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
  float,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { EARTH_TOPO_URL } from '../assets/config';
import { buildBiomeCanvas } from './MaterialGlobe';

const ATMOSPHERE_RADIUS = 1.06;
const ATMOSPHERE_FRESNEL_POWER = 4.5;
const ATMOSPHERE_INTENSITY = 0.55;

export class GlobeView {
  readonly earthMesh: THREE.Mesh;
  readonly spinGroup: THREE.Group; // вращение вокруг Y (drag по горизонтали)
  readonly tiltGroup: THREE.Group; // наклон вокруг X (drag по вертикали)

  private readonly readyPromise: Promise<void>;

  constructor(ctx: ThreeCtx) {
    const { THREE } = ctx;

    const earthMaterial = new THREE.MeshPhongNodeMaterial({ shininess: 12, specular: 0x223344 });

    this.tiltGroup = new THREE.Group();
    this.spinGroup = new THREE.Group();
    this.tiltGroup.add(this.spinGroup);
    ctx.scene.add(this.tiltGroup);

    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMaterial);
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

  // Строит стилизованную биом-текстуру (вместо фотоснимка), заворачивает в CanvasTexture
  // и подставляет в материал; отдельно (не блокируя готовность) грузит карту рельефа (bump).
  private async loadTexture(
    ctx: ThreeCtx,
    earthMaterial: THREE.MeshPhongNodeMaterial,
  ): Promise<void> {
    const { THREE } = ctx;
    const canvas = buildBiomeCanvas();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = ctx.renderer.getMaxAnisotropy();
    earthMaterial.map = tex;
    earthMaterial.needsUpdate = true;

    new THREE.TextureLoader().load(EARTH_TOPO_URL, (topo) => {
      earthMaterial.bumpMap = topo;
      earthMaterial.bumpScale = 0.6;
      earthMaterial.needsUpdate = true;
    });
  }

  // Резолвится, когда биом-текстура готова и подставлена в материал.
  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}
