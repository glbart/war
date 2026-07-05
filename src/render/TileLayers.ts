// Стриминг тайлов поверх глобуса: слой границ/названий (на любом зуме). Порт
// reference/earth-nuke.html строк ~203-370 (спутниковый слой снимков убран — глобус
// теперь стилизованная биом-текстура, см. MaterialGlobe.ts).
//
// Геометрия тайла — изогнутый патч (SEG×SEG сетка на сфере), LOD выбирается по
// дистанции камеры (zoom), набор видимых тайлов — по угловому радиусу области
// экрана (raycast по 4 углам вьюпорта на earthMesh). Меши тайлов пулятся по слою,
// текстуры кэшируются в LRU ~400 записей; при смене уровня LOD старые тайлы
// остаются подложкой, пока не догрузится новый уровень целиком.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from './Renderer';
import type { GlobeView } from './GlobeView';
import type { CameraRig } from '../input/CameraRig';
import { TILE_LABELS_URL } from '../assets/config';
import { latToTileYf, tileYfToLat, lonLatToDir, angleBetween } from '../sim/geo';

const SEG = 8; // сегментов на сторону патча тайла
const MAX_TILES_PER_LAYER = 160;
const CACHE_MAX = 400;
const CACHE_TRIM_TO = 300;

type TileCacheEntry = THREE.Texture | 'loading' | 'error';

interface DesiredTile {
  zt: number;
  xt: number;
  yt: number;
  dist: number;
}

interface TileLayerState {
  readonly name: string;
  readonly url: (z: number, x: number, y: number) => string;
  readonly group: THREE.Group;
  readonly unlit: boolean; // true → MeshBasicNodeMaterial (labels)
  readonly rOff: number; // сдвиг радиуса над поверхностью, чтобы слой не z-fighting'ил с нижним
  readonly minZ: number;
  enabled: boolean;
  readonly active: (s: number) => boolean; // s = zoom - 1
  readonly cache: Map<string, TileCacheEntry>;
  readonly meshes: Map<string, THREE.Mesh>;
  lastDesired: Set<string>;
}

const tileKey = (z: number, x: number, y: number): string => `${z}/${x}/${y}`;

export class TileLayers {
  private readonly layers: TileLayerState[];
  private readonly raycaster: THREE.Raycaster;
  private readonly tileLoader: THREE.TextureLoader;

  constructor(
    private readonly ctx: ThreeCtx,
    private readonly globe: GlobeView,
    private readonly rig: CameraRig,
  ) {
    const { THREE } = ctx;

    const overlayGroup = new THREE.Group(); // границы и названия поверх глобуса
    globe.spinGroup.add(overlayGroup);

    this.raycaster = new THREE.Raycaster();
    this.tileLoader = new THREE.TextureLoader();
    this.tileLoader.setCrossOrigin('anonymous');

    this.layers = [
      {
        name: 'labels',
        url: TILE_LABELS_URL,
        group: overlayGroup,
        unlit: true,
        rOff: 0.0009,
        minZ: 2,
        enabled: true,
        active: () => true,
        cache: new Map(),
        meshes: new Map(),
        lastDesired: new Set(),
      },
    ];
  }

  // Суммарное число активных мешей тайлов (для отладки/HUD).
  get meshCount(): number {
    let n = 0;
    for (const layer of this.layers) n += layer.meshes.size;
    return n;
  }

  setLabelsEnabled(v: boolean): void {
    const labels = this.layers.find((l) => l.name === 'labels');
    if (labels) labels.enabled = v;
  }

  // Вызывать раз в ~0.3с из игрового цикла — дороже кадрового рендера.
  update(): void {
    for (const layer of this.layers) this.reconcileLayer(layer);
  }

  // Изогнутый патч тайла [z/x/y] в виде сетки SEG×SEG на сфере (порт makeTileGeometry).
  private makeTileGeometry(z: number, x: number, y: number, rOff: number): THREE.BufferGeometry {
    const { THREE } = this.ctx;
    const n = 1 << z;
    const R = 1.0003 + z * 0.00015 + rOff; // чем детальнее уровень, тем выше слой
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= SEG; j++) {
      const lat = tileYfToLat(y + j / SEG, n);
      for (let i = 0; i <= SEG; i++) {
        const lon = ((x + i / SEG) / n) * 2 * Math.PI - Math.PI;
        const d = lonLatToDir(lon, lat);
        pos.push(d.x * R, d.y * R, d.z * R);
        uv.push(i / SEG, 1 - j / SEG);
      }
    }
    const W = SEG + 1;
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
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

  // Набор желаемых тайлов текущего LOD в видимой области (порт computeDesiredTiles).
  // LOD выбирается по дистанции камеры (zoom), область — по углу через raycast
  // в 4 угла экрана на earthMesh.
  private computeDesiredTiles(minZ: number): DesiredTile[] {
    const { THREE } = this.ctx;
    const camera = this.ctx.camera;
    const earth = this.globe.earthMesh;
    const spinGroup = this.globe.spinGroup;

    const d = this.rig.zoom;
    const s = Math.max(0.02, d - 1);
    const zt = THREE.MathUtils.clamp(
      Math.ceil(Math.log2((0.0296 * window.innerHeight) / s)),
      minZ,
      10,
    );
    const n = 1 << zt;
    const camLocal = spinGroup.worldToLocal(camera.position.clone()).normalize();
    const lat = Math.asin(THREE.MathUtils.clamp(camLocal.y, -1, 1));
    const lon = Math.atan2(-camLocal.z, camLocal.x);

    // Угловой радиус видимой области: лучи через углы экрана
    let gamma = 0;
    let allHit = true;
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      this.raycaster.setFromCamera(new THREE.Vector2(cx, cy), camera);
      const hit = this.raycaster.intersectObject(earth)[0];
      if (!hit) {
        allHit = false;
        break;
      }
      const hl = earth.worldToLocal(hit.point.clone()).normalize();
      gamma = Math.max(gamma, angleBetween(hl, camLocal));
    }
    const horizon = Math.acos(1 / d);
    gamma = allHit ? Math.min(gamma * 1.25 + Math.PI / n, horizon) : horizon + 0.05;

    const y0 = Math.max(0, Math.floor(latToTileYf(lat + gamma, n)));
    const y1 = Math.min(n - 1, Math.floor(latToTileYf(lat - gamma, n)));
    const xC = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * n);
    const halfLon = Math.PI / n;
    const out: DesiredTile[] = [];
    const seen = new Set<string>();
    for (let yt = y0; yt <= y1; yt++) {
      const rowLat = tileYfToLat(yt + 0.5, n);
      const dx = Math.min(
        Math.ceil(gamma / (2 * halfLon * Math.max(0.12, Math.cos(rowLat)))) + 1,
        n >> 1,
      );
      for (let k = -dx; k <= dx; k++) {
        const xt = (((xC + k) % n) + n) % n;
        const key = tileKey(zt, xt, yt);
        if (seen.has(key)) continue;
        seen.add(key);
        const cLon = ((xt + 0.5) / n) * 2 * Math.PI - Math.PI;
        const dist = angleBetween(lonLatToDir(cLon, rowLat), camLocal);
        if (dist < gamma + (2.2 * halfLon) / Math.max(0.3, Math.cos(rowLat))) {
          out.push({ zt, xt, yt, dist });
        }
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, MAX_TILES_PER_LAYER);
  }

  private addTileMesh(L: TileLayerState, key: string, t: DesiredTile, tex: THREE.Texture): void {
    const { THREE } = this.ctx;
    const mat = L.unlit
      ? new THREE.MeshBasicNodeMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshPhongNodeMaterial({
          map: tex,
          side: THREE.DoubleSide,
          shininess: 6,
          specular: 0x111111,
        });
    const mesh = new THREE.Mesh(this.makeTileGeometry(t.zt, t.xt, t.yt, L.rOff), mat);
    L.group.add(mesh);
    L.meshes.set(key, mesh);
  }

  // Приводит меши/кэш слоя к желаемому набору тайлов (порт reconcileLayer).
  private reconcileLayer(L: TileLayerState): void {
    const desired =
      L.enabled && L.active(this.rig.zoom - 1) ? this.computeDesiredTiles(L.minZ) : [];
    const curZ = desired[0]?.zt ?? 0;
    const desiredKeys = new Set(desired.map((t) => tileKey(t.zt, t.xt, t.yt)));
    L.lastDesired = desiredKeys;

    for (const t of desired) {
      const key = tileKey(t.zt, t.xt, t.yt);
      if (L.meshes.has(key)) continue;
      const cached = L.cache.get(key);
      if (cached === 'loading' || cached === 'error') continue;
      if (cached) {
        this.addTileMesh(L, key, t, cached);
        continue;
      }
      L.cache.set(key, 'loading');
      this.tileLoader.load(
        L.url(t.zt, t.xt, t.yt),
        (tex) => {
          const { THREE } = this.ctx;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = this.ctx.renderer.getMaxAnisotropy();
          L.cache.set(key, tex);
          if (L.lastDesired.has(key) && !L.meshes.has(key)) this.addTileMesh(L, key, t, tex);
        },
        undefined,
        () => L.cache.set(key, 'error'),
      );
    }

    // Тайлы прежнего уровня остаются подложкой, пока не догрузится текущий целиком
    const allLoaded = desired.every((t) => L.meshes.has(tileKey(t.zt, t.xt, t.yt)));
    for (const [key, mesh] of L.meshes) {
      if (desiredKeys.has(key)) continue;
      const z = Number(key.split('/')[0]);
      if (allLoaded || z === curZ || desired.length === 0) {
        L.group.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        L.meshes.delete(key);
      }
    }

    if (L.cache.size > CACHE_MAX) {
      for (const [key, tex] of L.cache) {
        if (L.cache.size <= CACHE_TRIM_TO) break;
        if (L.meshes.has(key) || tex === 'loading') continue;
        if (tex !== 'error') tex.dispose();
        L.cache.delete(key);
      }
    }
  }
}
