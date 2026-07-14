// Гибрид-рендер воксельной коры: нетронутые чанки не рисуются вовсе (планета — гладкий глобус);
// задетые carve'ом чанки мешатся Surface Nets и рисуются поверх, а глобус в их регионе
// discard'ится по HoleMask. Один материал на все чанки: цвет по атрибуту aMat
// (грунт → биом-текстура, порода/базальт/дно — палитра) + гарь из DamageField тем же uv.
//
// ОТКЛОНЕНИЕ от исходного брифа (резолюция ревью Task 6): uv В МАТЕРИАЛЕ НЕ берётся из
// вершинного атрибута `uv()`. Per-vertex equirect-UV рвётся у полюсов и на шве долготы
// (lon — разрывная функция направления, интерполяция между соседними вершинами размазывает
// текстуру через весь атлас). Вместо этого uv вычисляется В ШЕЙДЕРЕ из локальной позиции
// фрагмента (непрерывной по месту): atan2 по фрагменту не рвётся так, как интерполяция lon по
// вершинам. Атрибут `uv` в геометрию всё равно кладём — это контракт Task 6 (buildChunkGeo его
// отдаёт), three-материалам он не мешает, просто не участвует в этом colorNode.
import type * as THREE from 'three/webgpu';
import {
  texture,
  attribute,
  vec3,
  vec2,
  mix,
  clamp,
  select,
  positionLocal,
  normalize,
  atan,
  asin,
  PI,
  cross,
  uniform,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { Crust, MAT_SOIL, MAT_BASALT, MAT_WATER } from '../crust/Crust';
import { buildChunkGeo } from '../crust/chunkGeometry';
import type { FaceId } from '../crust/cubesphere';
import { CRUST_LAYER_COLORS, CRATER_MATERIAL_COLORS } from '../assets/config';
import { crackEmissiveNode, setEmissiveNode } from './effects/cracks';

// Точный тип float-юниформа (как в MagmaCore): .value — number, а не объединение перегрузок.
function makeFloatUniform(v: number) {
  return uniform(v);
}

// Узловой тип для промежуточной vec3-переменной (как в OceanShell/GlobeView): вытаскиваем
// Node<"vec3"> из сигнатуры cross (единственная перегрузка → ReturnType точен) — vec3(...)
// и select(...) возвращают более узкие подтипы (VarNode/ConditionalNode), несовместимые между
// собой при простом `let`, а через общий Node<"vec3"> реассайн проходит тайпчек.
type Vec3Node = ReturnType<typeof cross>;

export class CrustView {
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly group: THREE.Group;
  private readonly material: THREE.MeshPhongNodeMaterial;
  private readonly uTime = makeFloatUniform(0); // часы пульса трещин (толкает Scene.update)

  constructor(
    private readonly ctx: ThreeCtx,
    parent: THREE.Group,
    private readonly crust: Crust,
    biomeTex: THREE.Texture,
    damageTex: THREE.Texture,
  ) {
    const { THREE } = ctx;
    this.group = new THREE.Group();
    parent.add(this.group);

    const mat = new THREE.MeshPhongNodeMaterial({ shininess: 8, specular: 0x111111 });
    const aMat = attribute<'float'>('aMat', 'float');
    const cl = CRUST_LAYER_COLORS;

    // Equirect-uv из позиции фрагмента (конвенция сферы: v=(lat+π/2)/π, север=1).
    // Вершинный атрибут uv не используется: интерполяция lon через вершины рвётся у полюсов
    // и на шве долготы (lon — разрывная функция), а atan2 по фрагменту — непрерывен по месту.
    const p = normalize(positionLocal);
    const lon = atan(p.z.negate(), p.x);
    const lat = asin(clamp(p.y, -1, 1));
    const uvSphere = vec2(lon.add(PI).div(PI.mul(2)), lat.add(PI.div(2)).div(PI));

    const biome = texture(biomeTex, uvSphere).rgb;
    // палитра по материал-id: 1=грунт(биом) 2=порода 3=базальт 4=дно океана
    let col: Vec3Node = vec3(cl.rock[0], cl.rock[1], cl.rock[2]);
    col = select(aMat.lessThan(MAT_SOIL + 0.5), biome, col);
    col = select(
      aMat.greaterThan(MAT_BASALT - 0.5),
      vec3(cl.basalt[0], cl.basalt[1], cl.basalt[2]),
      col,
    );
    col = select(
      aMat.greaterThan(MAT_WATER - 0.5),
      vec3(cl.seabed[0], cl.seabed[1], cl.seabed[2]),
      col,
    );
    // гарь поверх (канал G поля урона, как на глобусе)
    const dmg = texture(damageTex, uvSphere);
    const cm = CRATER_MATERIAL_COLORS;
    col = mix(col, vec3(cm.scorch[0], cm.scorch[1], cm.scorch[2]), clamp(dmg.g.mul(0.8), 0, 1));
    mat.colorNode = col;
    // Трещины и на воксельных чанках (крышки/склоны) — без шва с глобусом (общий узел,
    // рисунок зависит только от направления фрагмента и поля урона).
    setEmissiveNode(mat, crackEmissiveNode(dmg.r, p, this.uTime));
    this.material = mat;
  }

  // Часы шейдера трещин (пульс) — толкает Scene.update раз за кадр.
  setTime(t: number): void {
    this.uTime.value = t;
  }

  // Ремешит перечисленные чанки (ключ 'f:cx:cy'): удаляет старый меш, строит новый. Маску дырок
  // (HoleMask) больше не метит — она красится по диску реального карва в Scene.startExplosion,
  // а не по AABB чанка (см. HoleMask.markCarve).
  update(changedKeys: string[]): void {
    const { THREE } = this.ctx;
    for (const key of changedKeys) {
      const [f, cx, cy] = key.split(':').map(Number) as [FaceId, number, number];
      const old = this.meshes.get(key);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        this.meshes.delete(key);
      }
      const geo = buildChunkGeo(this.crust, f, cx, cy);
      if (!geo) continue; // чанк выеден полностью — дырку закрывает магма-сфера
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(geo.uvs, 2));
      g.setAttribute('aMat', new THREE.BufferAttribute(geo.mats, 1));
      g.setIndex(new THREE.BufferAttribute(geo.indices, 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.material);
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
  }

  clear(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
  }
}
