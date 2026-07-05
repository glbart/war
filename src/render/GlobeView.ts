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
import { TEX_W, TEX_H, EARTH_TEXTURE_URL, EARTH_TOPO_URL } from '../assets/config';

const EARTH_LOAD_TIMEOUT_MS = 15000;
const ATMOSPHERE_RADIUS = 1.06;
const ATMOSPHERE_FRESNEL_POWER = 4.5;
const ATMOSPHERE_INTENSITY = 0.55;

// Процедурный фолбэк текстуры Земли (порт drawProceduralEarth(), строки ~144-167 эталона).
// Эталон использует собственный seeded LCG (не Math.random) ради стабильной картинки
// фолбэка между запусками — сохраняем эту деталь один в один.
function drawProceduralEarth(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, TEX_H);
  g.addColorStop(0, '#0a2a52');
  g.addColorStop(0.5, '#0e3a6e');
  g.addColorStop(1, '#0a2a52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  let seed = 1337;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.globalAlpha = 0.9;
  for (let c = 0; c < 14; c++) {
    const cx = rnd() * TEX_W;
    const cy = TEX_H * (0.18 + rnd() * 0.64);
    const hue = 80 + rnd() * 40;
    const size = 60 + rnd() * 140;
    for (let b = 0; b < 40; b++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * size;
      ctx.fillStyle = `hsl(${hue + rnd() * 20}, ${35 + rnd() * 20}%, ${28 + rnd() * 14}%)`;
      ctx.beginPath();
      ctx.ellipse(
        (cx + Math.cos(a) * d * 1.6 + TEX_W) % TEX_W,
        cy + Math.sin(a) * d,
        20 + rnd() * 50,
        14 + rnd() * 34,
        rnd() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e8f0f6';
  ctx.fillRect(0, 0, TEX_W, TEX_H * 0.05);
  ctx.fillRect(0, TEX_H * 0.95, TEX_W, TEX_H * 0.05);
}

// Грузит картинку Blue Marble; резолвится в null при ошибке или по таймауту 15с
// (порт loadEarthTexture(), строки ~170-179 эталона) — тогда включаем процедурный фолбэк.
function loadEarthImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const fallback = setTimeout(() => resolve(null), EARTH_LOAD_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(fallback);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(fallback);
      resolve(null);
    };
    img.src = EARTH_TEXTURE_URL;
  });
}

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

  // Грузит текстуру Земли в canvas (Blue Marble либо процедурный фолбэк), заворачивает
  // в CanvasTexture и подставляет в материал; отдельно (не блокируя готовность) грузит
  // карту рельефа (bump) — порт строк ~181-201 эталона.
  private async loadTexture(
    ctx: ThreeCtx,
    earthMaterial: THREE.MeshPhongNodeMaterial,
  ): Promise<void> {
    const { THREE } = ctx;
    const img = await loadEarthImage();

    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const canvasCtx = canvas.getContext('2d');
    if (canvasCtx) {
      if (img) canvasCtx.drawImage(img, 0, 0, TEX_W, TEX_H);
      else drawProceduralEarth(canvasCtx);
    }

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

  // Резолвится, когда текстура Земли (или процедурный фолбэк) готова и подставлена в материал.
  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}
