// Интерактивное волновое поле океана: equirect-текстура (R=высота, G=скорость), эволюция по
// волновому уравнению h'' = c²·∇²h − damping·h' на GPU через ping-pong два RenderTarget.
// step() гонит симуляцию каждый кадр; splat() впечатывает импульс (рябь/каверна от удара).
// Затухание возвращает поле к штилю → постоянного следа нет. Порт паттерна DamageField
// (snapshot-в-prevRt заменён на честный ping-pong read/write разных RT).
//
// Ping-pong без переуказания TextureNode (надёжный вариант): ДВА материала строят один и тот же
// TSL-граф, но читают разные RT — matA читает rtA и пишет в rtB, matB читает rtB и пишет в rtA.
// Каждый step() рендерит нужный материал в нужный RT и переключает флаг чётности. Юниформы общие
// для обоих материалов (splat/затухание/texel), граф вынесен в приватный buildStepMaterial().
//
// WebGL2: не используем MaxEquation/CustomBlending (см. DamageField — падает на WebGL2-бэкенде).
// Формат RGBA16F (HalfFloat) при наличии EXT_color_buffer_(half_)float; иначе — тихая деградация
// (step() = no-op, поле остаётся штилём) без исключений в render-петле.
import type * as THREE from 'three/webgpu';
import {
  uniform,
  vec4,
  vec2,
  uv,
  texture,
  float,
  sin,
  exp,
  length,
  sub,
  mul,
  clamp,
  add,
  PI,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import { detectBackend } from './backend/createThreeRenderer';
import type { Vec3 } from '../sim/geo';
import { dirToLonLat } from '../sim/geo';
import {
  WATER_FIELD_W,
  WATER_FIELD_H,
  WATER_WAVE_SPEED,
  WATER_WAVE_DAMPING,
  WATER_HEIGHT_DAMPING,
} from '../assets/config';

// dir (единичная нормаль на сфере) → UV в КООРДИНАТАХ ЗАПИСИ equirect-поля. Конвенция осей
// проекта (src/sim/geo.ts): dirToLonLat = { lon: atan2(-z, x), lat: asin(y) }; u = (lon+π)/2π,
// v = (π/2−lat)/π. ВАЖНО про V: сфера сэмплит поле при uv.y=(lat+π/2)/π, но RT-сэмплинг у three
// отражён по V относительно координат записи (texture(rtTex, uv) при uv.y=q возвращает фрагмент,
// отрисованный в квад-координате y=1−q; на GL — авто-flipY для isRenderTargetTexture в
// TextureNode.setupUV, на WebGPU — top-left origin). Потому центр записи v = 1−(lat+π/2)/π.
export function dirToFieldUV(dir: Vec3): { u: number; v: number } {
  const { lon, lat } = dirToLonLat(dir);
  return { u: (lon + Math.PI) / (2 * Math.PI), v: (Math.PI / 2 - lat) / Math.PI };
}

// Точные типы юниформов (как в DamageField/particles): конкретный overload uniform() вместо
// размытого объединения перегрузок — чтобы .value имел тип Vector2 / number.
function makeVec2Uniform(v: THREE.Vector2) {
  return uniform(v);
}
function makeFloatUniform(v: number) {
  return uniform(v);
}
type Vec2Uniform = ReturnType<typeof makeVec2Uniform>;
type FloatUniform = ReturnType<typeof makeFloatUniform>;

export class WaterField {
  private readonly rtA: THREE.RenderTarget;
  private readonly rtB: THREE.RenderTarget;
  // Канонический выходной RT: его .texture имеет СТАБИЛЬНУЮ идентичность на всю жизнь объекта
  // (как rt в DamageField). Внутренний ping-pong rtA/rtB альтернирует, поэтому в конце каждого
  // step() свежее поле блитится сюда — потребитель (OceanShell) захватывает .texture один раз.
  private readonly stableRt: THREE.RenderTarget;
  private readonly stampScene: THREE.Scene;
  private readonly stampCam: THREE.OrthographicCamera;
  private readonly stampMesh: THREE.Mesh;
  private readonly matA: THREE.MeshBasicNodeMaterial; // читает rtA, пишет в rtB
  private readonly matB: THREE.MeshBasicNodeMaterial; // читает rtB, пишет в rtA
  private readonly uTexel: Vec2Uniform;
  private readonly uC2: FloatUniform; // c²·dt²/dx² эффективный (фиксированный, см. Resolution 2)
  private readonly uDamp: FloatUniform; // затухание скорости
  private readonly uHDamp: FloatUniform; // затухание высоты (возврат к нулю, против уезда вверх)
  private readonly uSplatCenter: Vec2Uniform;
  private readonly uSplatStr: FloatUniform;
  private readonly uSplatRad: FloatUniform;
  private readonly supported: boolean;
  // true → актуальное состояние в rtA (следующий step читает rtA), false → в rtB.
  private aIsCurrent = true;
  // Счётчики для dev-зонда (__waterStats): сколько шагов симуляции и splat'ов реально прошло.
  private debugSteps = 0;
  private debugSplats = 0;

  constructor(private readonly ctx: ThreeCtx) {
    const { THREE } = ctx;
    this.supported = this.detectFloatSupport();

    const makeRT = (): THREE.RenderTarget => {
      const rt = new THREE.RenderTarget(WATER_FIELD_W, WATER_FIELD_H, {
        depthBuffer: false,
        type: THREE.HalfFloatType, // знаковая высота/скорость → нужен float-формат
        format: THREE.RGBAFormat,
      });
      rt.texture.wrapS = THREE.RepeatWrapping; // корректный wrap по шву долготы
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      return rt;
    };
    this.rtA = makeRT();
    this.rtB = makeRT();
    this.stableRt = makeRT();
    // Обнуляем ВСЕ три RT на старте. Критично для sim-RT (rtA/rtB): на WebGL2 нет гарантии
    // нуль-инициализации текстур — иначе первый step() прочитал бы мусор/NaN в лапласиане,
    // clamp(-4,4) NaN не санирует (сравнения с NaN = false), и порча пошла бы по ping-pong,
    // блитясь в stableRt каждый кадр → перманентно ломая «возврат к штилю». stableRt — чтобы
    // первый кадр OceanShell (до первого step, и в !supported-режиме) читал штиль, а не мусор.
    {
      const prevTarget = ctx.renderer.getRenderTarget();
      for (const rt of [this.rtA, this.rtB, this.stableRt]) {
        ctx.renderer.setRenderTarget(rt);
        ctx.renderer.clearColor();
      }
      ctx.renderer.setRenderTarget(prevTarget);
    }

    this.stampScene = new THREE.Scene();
    // Орто-камера смотрит вдоль -Z; квад в плоскости z=0, камера на z=1, near/far по обе стороны
    // (при near=0 квад оказался бы ровно на границе отсечения — риск не отрендериться).
    this.stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2);
    this.stampCam.position.z = 1;

    this.uTexel = makeVec2Uniform(new THREE.Vector2(1 / WATER_FIELD_W, 1 / WATER_FIELD_H));
    // Коэффициент волнового уравнения фиксирован (Resolution 2): стабильность 4-соседнего
    // лапласиана требует c²·dt²/dx² < 0.5; 0.25 — с запасом. dt в step() для него не используется.
    this.uC2 = makeFloatUniform(WATER_WAVE_SPEED);
    this.uDamp = makeFloatUniform(WATER_WAVE_DAMPING);
    this.uHDamp = makeFloatUniform(WATER_HEIGHT_DAMPING);
    this.uSplatCenter = makeVec2Uniform(new THREE.Vector2(0.5, 0.5));
    this.uSplatStr = makeFloatUniform(0);
    this.uSplatRad = makeFloatUniform(0.03);

    // Оба материала строят ОДИН И ТОТ ЖЕ граф, различаясь лишь читаемой текстурой (общие юниформы).
    this.matA = this.buildStepMaterial(this.rtA.texture);
    this.matB = this.buildStepMaterial(this.rtB.texture);

    this.stampMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matA);
    this.stampMesh.position.set(0.5, 0.5, 0);
    this.stampScene.add(this.stampMesh);
  }

  // Строит TSL-граф шага симуляции для материала, читающего заданную текстуру поля.
  private buildStepMaterial(readTex: THREE.Texture): THREE.MeshBasicNodeMaterial {
    const { THREE } = this.ctx;
    const uvC = uv();
    // cos(lat) = sin(v·π): у полюсов долгота «сжимается» — иначе круглый импульс вытянется в звезду
    // и шаг по U вдоль долготы был бы физически неверным.
    const latWeight = sin(uvC.y.mul(PI));
    const wLat = clamp(latWeight, float(0.15), float(1)); // клампим, чтобы шаг по U не взрывался у полюса
    const off = this.uTexel;
    // САМОЧТЕНИЕ поля — в координатах записи: RT-сэмплинг у three отражён по V относительно
    // координат отрисовки (см. комментарий у dirToFieldUV). Читать texture(readTex, uvC) напрямую
    // нельзя — каждый шаг зеркалил бы всё поле по широте, и рябь от удара мерцала бы между точкой
    // удара и зеркальной широтой («второй очаг на противоположной половине Земли»).
    const uvR = vec2(uvC.x, float(1).sub(uvC.y));
    const sample = (du: number, dv: number) =>
      texture(readTex, uvR.add(vec2(off.x.mul(du).div(wLat), off.y.mul(-dv))));

    const c = texture(readTex, uvR);
    const h = c.r; // высота
    const v = c.g; // скорость
    // 4-соседний лапласиан высоты.
    const lap = add(sample(-1, 0).r, sample(1, 0).r, sample(0, -1).r, sample(0, 1).r).sub(h.mul(4));
    // splat: гауссов импульс в скорость у центра (та же lat-поправка аспекта, что в DamageField).
    // Импульс бьёт воду ВНИЗ (каверна, как настоящий подрыв) — знак минус. Вверх (положительный)
    // давал купол высоты в точке удара → насыщенная пена читалась как сплошной «белый круг»;
    // с каверной пена ложится только на положительные гребни расходящихся волн отдачи.
    const dd = length(sub(uvC, this.uSplatCenter).mul(vec2(float(2).mul(latWeight), 1)));
    const norm = dd.div(this.uSplatRad);
    const impulse = this.uSplatStr.mul(exp(norm.mul(norm).negate())).negate();
    // semi-implicit: v' = (v + c²·lap)·(1−damp) + impulse; h' = h + v'. Клампим от разбегания.
    const vNew = clamp(
      add(mul(add(v, lap.mul(this.uC2)), float(1).sub(this.uDamp)), impulse),
      float(-4),
      float(4),
    );
    // Высота тоже затухает (не только скорость) — иначе средняя высота от всё-положительного
    // импульса уезжает вверх и не возвращается → поле белеет. Height-leak тянет h к нулю.
    const hNew = clamp(mul(add(h, vNew), float(1).sub(this.uHDamp)), float(-4), float(4));

    const mat = new THREE.MeshBasicNodeMaterial();
    // КРИТИЧНО: outputNode, НЕ colorNode. Стандартный вывод node-материалов клампится в ≥0
    // («force unsigned floats», NodeMaterial.setup: vec4(...).max(0)) — отрицательные высота и
    // скорость волны молча обнулялись бы при записи (каверна от удара исчезала, волны
    // полувыпрямлялись). outputNode подменяет результат ПОСЛЕ этого клампа и tone-mapping'а —
    // сырые знаковые данные доходят до HalfFloat RT как есть.
    mat.outputNode = vec4(hNew, vNew, 0, 1);
    mat.transparent = false;
    // NoBlending — запись данных, а не цвета (та же страховка, что в DamageField: не даём
    // opaque-пути и блендингу трогать значения).
    mat.blending = THREE.NoBlending;
    return mat;
  }

  // Best-effort проверка рендера в half-float. WebGPU — всегда; WebGL2 — по расширению
  // EXT_color_buffer_(half_)float. Если raw gl-контекст недоступен — оптимистично true (concern).
  private detectFloatSupport(): boolean {
    if (detectBackend(this.ctx.renderer) === 'webgpu') return true;
    const gl = (this.ctx.renderer.backend as { gl?: WebGL2RenderingContext } | null | undefined)
      ?.gl;
    if (!gl) return true; // не смогли проверить — HalfFloat в WebGL2 обычно доступен
    return (
      gl.getExtension('EXT_color_buffer_float') != null ||
      gl.getExtension('EXT_color_buffer_half_float') != null
    );
  }

  // Канонический выход: стабильная идентичность текстуры на всю жизнь объекта (потребитель
  // захватывает её один раз). Свежее поле блитится сюда в конце каждого step().
  get texture(): THREE.Texture {
    return this.stableRt.texture;
  }

  // Один шаг симуляции: читаем current-RT нужным материалом, пишем в другой, переключаем чётность.
  // dt оставлен в сигнатуре (Task 4 передаёт), но коэффициент фиксирован — шаг симуляции постоянный.
  step(dt: number): void {
    void dt; // намеренно не используется: шаг симуляции фиксирован (см. Resolution 2 / uC2)
    if (!this.supported) return; // тихая деградация: поле остаётся штилём, без исключений
    this.debugSteps += 1;
    // matA читает rtA → пишем в rtB; matB читает rtB → пишем в rtA. Источник захвачен в узлах
    // texture() материала (не читается императивно), поэтому явной переменной src не нужно.
    const dst = this.aIsCurrent ? this.rtB : this.rtA;
    this.stampMesh.material = this.aIsCurrent ? this.matA : this.matB;

    const prevTarget = this.ctx.renderer.getRenderTarget();
    const prevAutoClear = this.ctx.renderer.autoClear;
    // autoClear=true очистил бы dst перед draw — здесь это ок (шаг пишет весь кадр целиком),
    // но гасим и восстанавливаем, чтобы не трогать основной рендер сцены (полагается на true).
    this.ctx.renderer.autoClear = false;
    this.ctx.renderer.setRenderTarget(dst);
    this.ctx.renderer.render(this.stampScene, this.stampCam);
    this.ctx.renderer.setRenderTarget(prevTarget);
    this.ctx.renderer.autoClear = prevAutoClear;

    // Свежий кадр (в dst) блитим в канонический stableRt — дешёвый GPU-блит раз в кадр (тот же
    // приём copyTextureToTexture, что в DamageField). Так .texture держит стабильную идентичность.
    this.ctx.renderer.copyTextureToTexture(dst.texture, this.stableRt.texture);

    // Импульс применён за этот шаг — гасим, чтобы не впечатывать его повторно каждый кадр.
    this.uSplatStr.value = 0;
    this.aIsCurrent = !this.aIsCurrent; // ping-pong: свежий кадр теперь в dst
  }

  // Впечатывает импульс в поле у точки dir (применяется в ближайшем step()).
  splat(dir: Vec3, strength: number, radius: number): void {
    this.debugSplats += 1;
    const { u, v } = dirToFieldUV(dir);
    this.uSplatCenter.value.set(u, v);
    this.uSplatStr.value = strength;
    this.uSplatRad.value = radius;
  }

  // Dev-зонд (только для dev-хуков, см. src/debug/devHooks.ts): readback всего поля из stableRt,
  // min/max по каналам R (высота) и G (скорость). Даёт прямой факт «есть ли энергия в поле»
  // без интерпретации через шейдинг OceanShell. HalfFloat приходит как Uint16Array — декодируем.
  async debugStats(which: 'stable' | 'sim' = 'stable'): Promise<{
    hMin: number;
    hMax: number;
    vMin: number;
    vMax: number;
    supported: boolean;
    steps: number;
    splats: number;
    splatStr: number;
  }> {
    const rt = which === 'sim' ? (this.aIsCurrent ? this.rtA : this.rtB) : this.stableRt;
    const raw = (await this.ctx.renderer.readRenderTargetPixelsAsync(
      rt,
      0,
      0,
      WATER_FIELD_W,
      WATER_FIELD_H,
    )) as Float32Array | Uint16Array;
    const half2float = (h: number): number => {
      const s = (h & 0x8000) >> 15;
      const e = (h & 0x7c00) >> 10;
      const f = h & 0x03ff;
      if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
      if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
      return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
    };
    const at = (i: number): number =>
      raw instanceof Uint16Array ? half2float(raw[i] ?? 0) : (raw[i] ?? 0);
    let hMin = Infinity;
    let hMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = 0; i < raw.length; i += 4) {
      const h = at(i);
      const v = at(i + 1);
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    return {
      hMin,
      hMax,
      vMin,
      vMax,
      supported: this.supported,
      steps: this.debugSteps,
      splats: this.debugSplats,
      splatStr: this.uSplatStr.value,
    };
  }

  // Dev-зонд: залить все три RT константой (дискриминирующий тест: виден ли readback,
  // затухает ли значение по шагам → рендерит ли step, доносит ли блит до stableRt).
  debugFill(value: number): void {
    const { THREE } = this.ctx;
    const renderer = this.ctx.renderer;
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(new THREE.Color(value, value, value), 1);
    const prevTarget = renderer.getRenderTarget();
    for (const rt of [this.rtA, this.rtB, this.stableRt]) {
      renderer.setRenderTarget(rt);
      renderer.clearColor();
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  // Полная очистка всех буферов → штиль (planetReset). stableRt тоже — иначе .texture показал бы
  // старое поле до первого step() после сброса.
  clear(): void {
    const prevTarget = this.ctx.renderer.getRenderTarget();
    for (const rt of [this.rtA, this.rtB, this.stableRt]) {
      this.ctx.renderer.setRenderTarget(rt);
      this.ctx.renderer.clearColor();
    }
    this.ctx.renderer.setRenderTarget(prevTarget);
    this.uSplatStr.value = 0;
    this.aIsCurrent = true;
  }
}
