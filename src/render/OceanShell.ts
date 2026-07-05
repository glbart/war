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
  modelNormalMatrix,
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
import { fbm3 } from './noise';

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
    fbm3(d.mul(70.0 * WAVE_W).add(vec3(0.0, 0.0, t.mul(0.6))), 5)
      .sub(0.5)
      .mul(1.1),
  );
  return h.mul(WAVE_AMP);
});

// Нормаль воды из градиента высоты волн: конечные разности в касательной плоскости к n.
// Высоту в самой точке (h0) передаём снаружи — она же нужна для пены, чтобы не считать
// дорогой 5-октавный ambient дважды.
const waterNormal = Fn(([n, t, h0]: [Vec3Node, FloatNode, FloatNode]) => {
  // касательный базис у n; у полюса (|n.y|≈1) берём иную опорную ось, чтобы cross не выродился
  const upRef = select(lessThan(abs(n.y), float(0.99)), vec3(0, 1, 0), vec3(1, 0, 0));
  const t1 = normalize(cross(upRef, n));
  const t2 = cross(n, t1);
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
    const V = normalize(cameraPosition.sub(positionWorld)); // взгляд — мировой кадр

    // Пространственный ключ волн/пены — ЛОКАЛЬНЫЙ кадр глобуса (стабилен при вращении spinGroup;
    // мировая нормаль в фиксированной точке крутится с автоповоротом → узор бы «плыл»).
    const nLocal = normalLocal;
    const hAmb = ambient(nLocal, t); // высота волн — один раз, для нормали И для пены

    // Нормаль постоянного волнения (fbm-волны — основной облик) в локальном кадре.
    const NwaveLocal = waterNormal(nLocal, t, hAmb);
    // Добавка от градиента поля удара: наклон нормали по uv-разностям (поле тоже локально-привязано).
    const fgx = texture(fieldTex, uv().add(vec2(FIELD_EPS, 0))).r.sub(fieldH);
    const fgy = texture(fieldTex, uv().add(vec2(0, FIELD_EPS))).r.sub(fieldH);
    const upRef = select(lessThan(abs(nLocal.y), float(0.99)), vec3(0, 1, 0), vec3(1, 0, 0));
    const tb1 = normalize(cross(upRef, nLocal));
    const tb2 = cross(nLocal, tb1);
    const nPerturbed = normalize(
      NwaveLocal.sub(tb1.mul(fgx.mul(FIELD_NORMAL)).add(tb2.mul(fgy.mul(FIELD_NORMAL)))),
    );
    // Возмущённую ЛОКАЛЬНУЮ нормаль → мировой кадр для освещения (солнце/Френель/блик — мировые).
    const N = normalize(modelNormalMatrix.mul(nPerturbed));

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

    // Пена: гребни постоянных волн (hAmb посчитан выше) + береговая полоса + гребни удара.
    const crest = smoothstep(0.35, 0.9, hAmb).mul(FOAM);
    const shoreNoise = fbm3(nLocal.mul(90.0).add(vec3(0.0, 0.0, t.mul(0.4))), 5);
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
    // depthWrite=false — как у прочих transparent-оверлеев проекта (Decal/Explosion/WaterBurst):
    // пиксели суши (opacity 0) не должны писать глубину на R_OCEAN и оклюзировать полосу r∈[1,R_OCEAN].
    mat.depthWrite = false;
    // Страховка от z-fighting с ocean-цветом глобуса (в дополнение к R_OCEAN>1).
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R_OCEAN, OCEAN_LON_SEG, OCEAN_LAT_SEG),
      mat,
    );
    // Рисуется после глобуса (opaque, renderOrder 0) — задняя полусфера отсекается depthTest'ом
    // по записанной глобусом глубине. Атмосфера (GlobeView) тоже renderOrder 0, но transparent+
    // additive+BackSide: она уходит в тот же transparent-проход; порядок вода/атмосфера на силуэте
    // некритичен (оба свечения мягкие) — при желании тонко настраивается в визуальной приёмке.
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
  }

  setTime(t: number): void {
    this.uTime.value = t;
  }
}
