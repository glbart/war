// src/render/OceanShell.ts
// Анимированная водная оболочка океана поверх глобуса. Сфера радиуса R_OCEAN (чуть больше
// глобуса r=1), ручной TSL-шейдинг на MeshBasicNodeMaterial БЕЗ динамического света (как
// GlobeView.buildAtmosphere): солнце — из константы OCEAN_SUN_DIR, весь свет считаем вручную.
//
// Облик перенесён с утверждённого визуального эталона (scratchpad/water-mockup.html): постоянное
// волнение — направленные Gerstner-свеллы + анимированный fbm-шум (3 октавы) по uTime (это
// «жизнь» воды); интерактивное WaterField даёт ТОЛЬКО отклик на удар (каверна/рябь) — вершинный
// макро-сдвиг + добавка к нормали через градиент поля. Цвет: глубина по CoastField → Френель-небо
// → блик константного солнца (Blinn) → диффуз → пена (гребни шума + берег + гребни удара).
// Discard на суше — по CoastField (opacityNode). Текстуры поля/берега захвачены ОДИН раз в
// конструкторе (у WaterField.texture стабильная идентичность) — не перечитываем каждый кадр.
import type * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  sin,
  floor,
  fract,
  dot,
  cross,
  normalize,
  abs,
  pow,
  clamp,
  mix,
  smoothstep,
  select,
  lessThan,
  oneMinus,
  positionLocal,
  normalLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import {
  R_OCEAN,
  OCEAN_SUN_DIR,
  OCEAN_LON_SEG,
  OCEAN_LAT_SEG,
  MAX_CRATER_DEPTH,
} from '../assets/config';

// Точный тип float-юниформа (как в WaterBurstView/particles): .value остаётся number.
function makeFloatUniform(v: number) {
  return uniform(v);
}

// Узловые типы для аргументов TSL-функций (Fn): вытаскиваем Node<"float"> / Node<"vec3"> из
// сигнатур dot/cross (единственные перегрузки → ReturnType точен), чтобы не тянуть внутренний
// путь three к типу Node.
type FloatNode = ReturnType<typeof dot>;
type Vec3Node = ReturnType<typeof cross>;

// Параметры волнения (в мокапе — слайдеры HUD; здесь запечены константами, UI не переносим).
const WAVE_W = 0.8; // масштаб частоты волн (0.35 + «ветер» 0.45 из мокапа)
const WAVE_AMP = 0.55; // общая высота волн
const FOAM = 0.5; // сила пены
const NORMAL_E = 0.0016; // шаг конечных разностей для нормали волн (в направлении)
const NORMAL_SC = 0.02; // сила рельефа нормали волн
const FIELD_EPS = 0.003; // шаг конечных разностей по uv поля (отклик удара)
const FIELD_NORMAL = 8.0; // сила наклона нормали от градиента поля (каверна/рябь)

// ---------- шум (порт hash/noise/fbm из мокапа на TSL) ----------
// value-noise на основе хеша от целочисленной решётки; fbm — 5 октав.
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
  for (let k = 0; k < 5; k++) {
    s = s.add(noise(pp).mul(a));
    pp = pp.mul(2.02);
    a *= 0.5;
  }
  return s;
});

// ---------- волнение (порт ambient/waterNormal из мокапа) ----------
// Высота волн в точке направления d (единичный вектор) в момент t: три направленных свелла +
// мелкая рябь fbm. Это постоянное волнение — «жизнь» воды (поле удара сюда НЕ входит).
const ambient = Fn(([d, t]: [Vec3Node, FloatNode]) => {
  let h: FloatNode = sin(
    dot(d, vec3(1.0, 0.3, 0.2))
      .mul(22.0 * WAVE_W)
      .add(t.mul(1.1)),
  ).mul(0.5);
  h = h.add(
    sin(
      dot(d, vec3(-0.2, 0.5, 1.0))
        .mul(30.0 * WAVE_W)
        .add(t.mul(1.4)),
    ).mul(0.35),
  );
  h = h.add(
    sin(
      dot(d, vec3(0.7, -0.4, 0.6))
        .mul(44.0 * WAVE_W)
        .sub(t.mul(1.7)),
    ).mul(0.22),
  );
  h = h.add(
    fbm(d.mul(70.0 * WAVE_W).add(vec3(0.0, 0.0, t.mul(0.6))))
      .sub(0.5)
      .mul(1.1),
  );
  return h.mul(WAVE_AMP);
});

// Нормаль воды из градиента высоты волн: конечные разности в касательной плоскости к n.
const waterNormal = Fn(([n, t]: [Vec3Node, FloatNode]) => {
  // касательный базис у n; у полюса (|n.y|≈1) берём иную опорную ось, чтобы cross не выродился
  const upRef = select(lessThan(abs(n.y), float(0.99)), vec3(0, 1, 0), vec3(1, 0, 0));
  const t1 = normalize(cross(upRef, n));
  const t2 = cross(n, t1);
  const h0 = ambient(n, t);
  const hx = ambient(normalize(n.add(t1.mul(NORMAL_E))), t);
  const hy = ambient(normalize(n.add(t2.mul(NORMAL_E))), t);
  const grad = t1
    .mul(hx.sub(h0))
    .add(t2.mul(hy.sub(h0)))
    .mul(NORMAL_SC / NORMAL_E);
  return normalize(n.sub(grad));
});

export class OceanShell {
  private readonly uTime = makeFloatUniform(0);
  readonly mesh: THREE.Mesh;

  constructor(
    ctx: ThreeCtx,
    parent: THREE.Group,
    fieldTex: THREE.Texture,
    coastTex: THREE.Texture,
  ) {
    const { THREE } = ctx;
    const mat = new THREE.MeshBasicNodeMaterial();
    const t = this.uTime;
    const sun = normalize(vec3(OCEAN_SUN_DIR[0], OCEAN_SUN_DIR[1], OCEAN_SUN_DIR[2]));

    // Захват текстур ОДИН раз (Resolution 1): стабильная идентичность WaterField.texture.
    // Поле удара (R=высота, G=скорость) и маска берега (0 суша → 1 открытый океан) в equirect uv.
    const field = texture(fieldTex, uv());
    const coast = texture(coastTex, uv()).r;
    const fieldH = field.r;

    // --- Вершина: макро-Gerstner (постоянные свеллы) + макро-отклик поля (удар), сдвиг вдоль
    // нормали. Амплитуды малы (доли радиуса). На суше (coast≈0) не двигаем. ---
    const p = positionLocal;
    const g1 = sin(
      dot(p, vec3(1.0, 0.3, 0.2))
        .mul(9.0)
        .add(t.mul(1.1)),
    );
    const g2 = sin(
      dot(p, vec3(-0.2, 0.5, 1.0))
        .mul(13.0)
        .add(t.mul(1.4)),
    );
    const macro = g1.mul(0.5).add(g2.mul(0.35)).mul(0.0015);
    const interactive = fieldH.mul(MAX_CRATER_DEPTH).mul(1.5); // каверна/рябь удара
    const disp = macro.add(interactive).mul(coast);
    mat.positionNode = positionLocal.add(normalLocal.mul(disp));

    // --- Фрагмент (мир-пространство, как атмосфера: без света, вручную) ---
    const V = normalize(cameraPosition.sub(positionWorld));
    const N0 = normalWorld; // базовая геонормаль сферы

    // Нормаль постоянного волнения (fbm-волны — основной облик).
    const Nwave = waterNormal(N0, t);
    // Добавка от градиента поля удара: наклон нормали в касательной плоскости по uv-разностям.
    const fgx = texture(fieldTex, uv().add(vec2(FIELD_EPS, 0))).r.sub(fieldH);
    const fgy = texture(fieldTex, uv().add(vec2(0, FIELD_EPS))).r.sub(fieldH);
    const upRef = select(lessThan(abs(N0.y), float(0.99)), vec3(0, 1, 0), vec3(1, 0, 0));
    const tb1 = normalize(cross(upRef, N0));
    const tb2 = cross(N0, tb1);
    const N = normalize(
      Nwave.sub(tb1.mul(fgx.mul(FIELD_NORMAL)).add(tb2.mul(fgy.mul(FIELD_NORMAL)))),
    );

    // Цвет: глубина по берегу (мелководье → глубина).
    const clar = 0.7; // «прозрачность» из мокапа (mix(0.25,1.0, 0.6))
    const deep = vec3(0.015, 0.1, 0.2);
    const shallow = mix(vec3(0.1, 0.42, 0.48), vec3(0.05, 0.28, 0.42), clar);
    const base = mix(shallow, deep, coast);

    // Френель → отражение неба (градиент по вертикали взгляда).
    const fres = pow(oneMinus(clamp(dot(N, V), 0, 1)), 4);
    const sky = mix(
      vec3(0.15, 0.3, 0.52),
      vec3(0.55, 0.72, 0.95),
      clamp(V.y.mul(0.5).add(0.5), 0, 1),
    );
    let col = mix(base, sky, fres.mul(0.85));

    // Блик константного солнца (Blinn-Phong — статичный источник, без динсвета).
    const H = normalize(sun.add(V));
    const spec = pow(clamp(dot(N, H), 0, 1), 220);
    col = col.add(vec3(1.0, 0.96, 0.85).mul(spec.mul(1.4)));

    // Диффуз для объёма.
    const diff = clamp(dot(N, sun), 0, 1);
    col = col.mul(float(0.55).add(diff.mul(0.55)));

    // Пена: гребни постоянных волн + береговая полоса + гребни удара (высота поля).
    const hAmb = ambient(N0, t);
    const crest = smoothstep(0.35, 0.9, hAmb).mul(FOAM);
    const shoreNoise = fbm(N0.mul(90.0).add(vec3(0.0, 0.0, t.mul(0.4))));
    const shoreFoam = oneMinus(coast)
      .mul(smoothstep(0.2, 0.6, shoreNoise))
      .mul(FOAM * 0.8);
    const strikeFoam = smoothstep(0.25, 0.7, fieldH);
    const foam = clamp(crest.add(shoreFoam).add(strikeFoam), 0, 1);
    col = mix(col, vec3(0.85, 0.94, 1.0), foam.mul(0.75));

    mat.colorNode = vec4(col, 1);
    // Discard суши по CoastField: прозрачность 0 там, где coast≈0 (суша); мягкий берег.
    mat.opacityNode = smoothstep(0.02, 0.08, coast);
    mat.transparent = true;
    mat.depthWrite = true;
    // Страховка от z-fighting с ocean-цветом глобуса (в дополнение к R_OCEAN>1).
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R_OCEAN, OCEAN_LON_SEG, OCEAN_LAT_SEG),
      mat,
    );
    this.mesh.renderOrder = 1; // после глобуса (0), до атмосферы-additive
    parent.add(this.mesh);
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }
}
