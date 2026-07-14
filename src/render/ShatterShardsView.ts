// Вью киношного разрыва планеты (ревизия спеки 2026-07-14 §5): куски-плиты из shatterShards
// в момент раскола бесшовно подменяют глобус (вместе — та же сфера) и в замедленном темпе
// разлетаются в стороны с медленным кувырканием. Движение — CPU-трансформы ~14 мешей на кадр
// (дёшево, без аллокаций: скорость/оси предвычислены в spawn, кватернион переиспользуется).
// Материал один на все куски: внешняя корка — биом (equirect-uv из ЛОКАЛЬНОЙ позиции —
// она не меняется при полёте, кусок несёт свой участок карты с собой); изнанка и срезы —
// градиент порода→магма по глубине с эмиссией (раскалены изнутри). DoubleSide — стенки
// видны с любой стороны, точная намотка не нужна.
import type * as THREE from 'three/webgpu';
import {
  texture,
  vec2,
  vec3,
  mix,
  clamp,
  positionLocal,
  normalize,
  atan,
  asin,
  length,
  smoothstep,
  float,
  PI,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { buildShardData } from './shatterShards';
import { setEmissiveNode } from './effects/cracks';
import {
  CRUST_LAYER_COLORS,
  CRACK_COLOR,
  SHATTER_SHELL_INNER,
  SHATTER_PLATE_SPEED_MIN,
  SHATTER_PLATE_SPEED_MAX,
  SHATTER_PLATE_RAMP_T,
  SHATTER_PLATE_SPIN_MAX,
} from '../assets/config';

interface ShardMotion {
  mesh: THREE.Mesh;
  dir: THREE.Vector3; // ось разлёта (центр куска)
  speed: number; // радиусов/с после разгона
  spinAxis: THREE.Vector3;
  spinSpeed: number; // рад/с
}

export class ShatterShardsView {
  private readonly group: THREE.Group;
  private readonly material: THREE.MeshPhongNodeMaterial;
  private shards: ShardMotion[] = [];
  private elapsed = 0; // сек с момента раскола
  private readonly tmpQuat: THREE.Quaternion; // переиспользуемый кватернион кувыркания

  constructor(
    private readonly ctx: ThreeCtx,
    parent: THREE.Group,
    biomeTex: THREE.Texture,
  ) {
    const { THREE } = ctx;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.tmpQuat = new THREE.Quaternion();

    // Материал кусков. Радиус ЛОКАЛЬНОЙ позиции фрагмента различает корку (r≈1) и
    // глубину (r→SHELL_INNER): t=0 — поверхность (биом), t=1 — самая изнанка (магма).
    const mat = new THREE.MeshPhongNodeMaterial({ shininess: 8, specular: 0x111111 });
    mat.side = THREE.DoubleSide;
    const p = normalize(positionLocal);
    const lon = atan(p.z.negate(), p.x);
    const lat = asin(clamp(p.y, -1, 1));
    const uvSphere = vec2(lon.add(PI).div(PI.mul(2)), lat.add(PI.div(2)).div(PI));
    const biome = texture(biomeTex, uvSphere).rgb;
    const depth = clamp(
      float(1)
        .sub(length(positionLocal))
        .div(1 - SHATTER_SHELL_INNER),
      0,
      1,
    );
    const cl = CRUST_LAYER_COLORS;
    const hotRock = mix(
      vec3(cl.rock[0], cl.rock[1], cl.rock[2]),
      vec3(CRACK_COLOR[0], CRACK_COLOR[1], CRACK_COLOR[2]),
      smoothstep(float(0.35), float(1), depth),
    );
    // Корка → горячая порода: переход сразу под поверхностью (срезы читаются как разлом).
    mat.colorNode = mix(biome, hotRock, smoothstep(float(0.02), float(0.12), depth));
    // Изнанка светится магмой (кламп ≥0 — грабли NodeMaterial).
    setEmissiveNode(
      mat,
      vec3(CRACK_COLOR[0], CRACK_COLOR[1], CRACK_COLOR[2]).mul(
        clamp(depth.mul(depth).mul(0.9), 0, 1),
      ),
    );
    this.material = mat;
  }

  // Раскол: строит куски (детерминированно от seed) и запускает замедленный разлёт.
  spawn(seed: number): void {
    this.clear();
    const { THREE } = this.ctx;
    let s = seed | 0 || 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;

    for (const data of buildShardData(seed)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.material);
      this.group.add(mesh);
      // Ось кувыркания — случайная, скорость малая: куски тяжёлые, темп «киношный».
      const az = rnd() * Math.PI * 2;
      const cz = rnd() * 2 - 1;
      const sxy = Math.sqrt(Math.max(0, 1 - cz * cz));
      this.shards.push({
        mesh,
        dir: new THREE.Vector3(data.center.x, data.center.y, data.center.z),
        speed:
          SHATTER_PLATE_SPEED_MIN + rnd() * (SHATTER_PLATE_SPEED_MAX - SHATTER_PLATE_SPEED_MIN),
        spinAxis: new THREE.Vector3(sxy * Math.cos(az), sxy * Math.sin(az), cz),
        spinSpeed: (0.2 + rnd() * 0.8) * SHATTER_PLATE_SPIN_MAX * (rnd() < 0.5 ? -1 : 1),
      });
    }
    this.elapsed = 0;
  }

  // Замедленный разлёт: скорость нарастает от нуля smoothstep'ом за SHATTER_PLATE_RAMP_T —
  // сначала расходятся щели (сквозь них светит ядро), потом куски разгоняются в стороны.
  update(dt: number): void {
    if (this.shards.length === 0) return;
    this.elapsed += dt;
    const r = Math.min(1, this.elapsed / SHATTER_PLATE_RAMP_T);
    const ramp = r * r * (3 - 2 * r);
    for (const sh of this.shards) {
      const dist = sh.speed * this.elapsed * ramp;
      sh.mesh.position.set(sh.dir.x * dist, sh.dir.y * dist, sh.dir.z * dist);
      this.tmpQuat.setFromAxisAngle(sh.spinAxis, sh.spinSpeed * this.elapsed);
      sh.mesh.quaternion.copy(this.tmpQuat);
    }
  }

  // Восстановление планеты: куски убираются (геометрии одноразовые, материал общий — живёт).
  clear(): void {
    for (const sh of this.shards) {
      this.group.remove(sh.mesh);
      sh.mesh.geometry.dispose();
    }
    this.shards = [];
    this.elapsed = 0;
  }
}
