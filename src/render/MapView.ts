// Плоская политическая карта (спека 2026-08-29-flat-map-design.md): отдельная сцена с
// ортокамерой, плоскость с текстурой реальных границ, маркеры городов, панорама и зум.
// Глобус не трогаем — переключение видов идёт подменой сцены и камеры в рендерере.
import type * as THREE from 'three/webgpu';
import { instancedBufferAttribute, positionLocal, uv, texture, vec4 } from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { buildPoliticalPixels, mapUvToLonLat, lonLatToMapUv, MAP_W, MAP_H } from './politicalMap';
import { createCities } from '../sim/cities';
import { factionById, type FactionId } from '../sim/factions';
import { factionAt } from '../sim/countries';
import { lonLatToDir, dirToLonLat, type Vec3 } from '../sim/geo';
import {
  MAP_ZOOM_MIN,
  MAP_ZOOM_MAX,
  MAP_MARKER_SIZE,
  MARKER_DEAD_SIZE_FRAC,
  MARKER_DEAD_COLOR_FRAC,
  MARKER_POP_REF,
} from '../assets/config';

// Карта — прямоугольник 2:1 в мировых координатах сцены карты.
const MAP_HALF_W = 1;
const MAP_HALF_H = 0.5;

export class MapView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;

  private readonly tex: THREE.DataTexture;
  private readonly cities = createCities();
  private readonly index = new Map<string, number>();
  private readonly aMarker: Float32Array; // (x, y, size, alive)
  private readonly aColor: Float32Array; // (r, g, b, pad)
  private readonly markerAttr: THREE.InstancedBufferAttribute;
  private readonly colorAttr: THREE.InstancedBufferAttribute;

  private zoom = 1;
  // Панель HUD закрывает левую часть экрана, поэтому вид по умолчанию сдвинут на восток:
  // в чистой зоне оказывается самая насыщенная часть карты (Европа, Азия, Африка).
  private panX = 0.2;
  private panY = 0;
  private aspect = 16 / 9;

  constructor(ctx: ThreeCtx) {
    const { THREE } = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 10);
    this.camera.position.set(0, 0, 2);

    // Текстура политической карты: реальные границы + заливка по сторонам.
    this.tex = new THREE.DataTexture(buildPoliticalPixels(), MAP_W, MAP_H);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;

    const planeMat = new THREE.MeshBasicNodeMaterial();
    // Текстура нарисована сверху вниз (v=0 — северный полюс), плоскость — снизу вверх.
    planeMat.colorNode = texture(this.tex, vec4(uv().x, uv().y.oneMinus(), 0, 0).xy);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF_W * 2, MAP_HALF_H * 2), planeMat);
    this.scene.add(plane);

    // Маркеры городов: инстансированные квадраты поверх карты, цвет — сторона-владелец.
    const n = this.cities.length;
    this.aMarker = new Float32Array(n * 4);
    this.aColor = new Float32Array(n * 4);
    this.cities.forEach((c, i) => this.index.set(c.name, i));
    this.markerAttr = new THREE.InstancedBufferAttribute(this.aMarker, 4);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.aColor, 4);
    this.markerAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);

    const aMarker = instancedBufferAttribute<'vec4'>(this.markerAttr, 'vec4');
    const aColor = instancedBufferAttribute<'vec4'>(this.colorAttr, 'vec4');
    const markerMat = new THREE.MeshBasicNodeMaterial();
    markerMat.positionNode = positionLocal
      .mul(aMarker.z)
      .add(aMarker.xyz.mul(vec4(1, 1, 0, 0).xyz));
    markerMat.colorNode = aColor.xyz;
    const markers = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), markerMat, n);
    markers.frustumCulled = false;
    markers.renderOrder = 1;
    this.scene.add(markers);

    this.clearCities();
    this.updateCamera();
  }

  // Город на карте: позиция из equirect-проекции, размер от населения, цвет стороны.
  private writeCity(i: number, aliveFrac: number): void {
    const city = this.cities[i]!;
    const { lon, lat } = dirToLonLat(city.dir);
    const { u, v } = lonLatToMapUv(lon, lat);
    const alive = Math.min(1, Math.max(0, aliveFrac));
    const size =
      MAP_MARKER_SIZE *
      (0.5 + 0.5 * Math.min(1, city.pop / MARKER_POP_REF)) *
      (MARKER_DEAD_SIZE_FRAC + (1 - MARKER_DEAD_SIZE_FRAC) * alive);
    const dim = MARKER_DEAD_COLOR_FRAC + (1 - MARKER_DEAD_COLOR_FRAC) * alive;
    const color = factionById(city.faction).color;

    this.aMarker[i * 4] = (u - 0.5) * MAP_HALF_W * 2;
    this.aMarker[i * 4 + 1] = (0.5 - v) * MAP_HALF_H * 2;
    this.aMarker[i * 4 + 2] = size;
    this.aMarker[i * 4 + 3] = alive;
    this.aColor[i * 4] = color[0] * dim;
    this.aColor[i * 4 + 1] = color[1] * dim;
    this.aColor[i * 4 + 2] = color[2] * dim;
    this.markerAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  setCityAlive(name: string, alive: number): void {
    const i = this.index.get(name);
    if (i === undefined) return;
    const pop = this.cities[i]!.pop;
    this.writeCity(i, pop > 0 ? alive / pop : 0);
  }

  clearCities(): void {
    for (let i = 0; i < this.cities.length; i++) this.writeCity(i, 1);
  }

  // Подсветка территории выбранной стороны — перекрашиваем текстуру целиком (редкое событие).
  setHighlight(faction: FactionId | undefined): void {
    this.tex.image.data = buildPoliticalPixels(faction) as unknown as Uint8ClampedArray;
    this.tex.needsUpdate = true;
  }

  resize(w: number, h: number): void {
    this.aspect = w / Math.max(1, h);
    this.updateCamera();
  }

  panBy(dxPx: number, dyPx: number, viewportH: number): void {
    const worldPerPx = (2 * MAP_HALF_H) / this.zoom / Math.max(1, viewportH);
    this.panX -= dxPx * worldPerPx;
    this.panY += dyPx * worldPerPx;
    this.updateCamera();
  }

  zoomBy(delta: number): void {
    this.zoom = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, this.zoom * Math.exp(-delta)));
    this.updateCamera();
  }

  // Ортокамера показывает окно высотой (2·MAP_HALF_H / zoom); ширина — по аспекту экрана.
  private updateCamera(): void {
    const halfH = MAP_HALF_H / this.zoom;
    const halfW = halfH * this.aspect;
    // Не выпускаем окно за пределы карты по вертикали; по горизонтали карта бесшовна.
    const limitY = Math.max(0, MAP_HALF_H - halfH);
    this.panY = Math.min(limitY, Math.max(-limitY, this.panY));
    this.camera.left = this.panX - halfW;
    this.camera.right = this.panX + halfW;
    this.camera.top = this.panY + halfH;
    this.camera.bottom = this.panY - halfH;
    this.camera.updateProjectionMatrix();
  }

  // Какая сторона владеет точкой под курсором (для выбора цели кликом по стране).
  factionAtScreen(clientX: number, clientY: number, w: number, h: number): FactionId | undefined {
    const dir = this.pick(clientX, clientY, w, h);
    if (dir === undefined) return undefined;
    const { lon, lat } = dirToLonLat(dir);
    return factionAt(lon, lat);
  }

  // Экранная точка → направление на сфере (для удара) и координаты, если попали в карту.
  pick(clientX: number, clientY: number, w: number, h: number): Vec3 | undefined {
    const ndcX = (clientX / w) * 2 - 1;
    const ndcY = 1 - (clientY / h) * 2;
    const halfH = MAP_HALF_H / this.zoom;
    const halfW = halfH * this.aspect;
    const worldX = this.panX + ndcX * halfW;
    const worldY = this.panY + ndcY * halfH;
    if (worldY < -MAP_HALF_H || worldY > MAP_HALF_H) return undefined;
    const u = worldX / (MAP_HALF_W * 2) + 0.5;
    const v = 0.5 - worldY / (MAP_HALF_H * 2);
    const { lon, lat } = mapUvToLonLat(u, v);
    return lonLatToDir(lon, lat);
  }
}
