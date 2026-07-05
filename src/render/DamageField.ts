// Накопительное equirect-поле урона планеты. Каналы: R=глубина чаши (вниз), G=гарь-градиент
// (широкий, мягкий, шире самой чаши), B=оплавление/полынья (лёд, как раньше), A=вал+эжекта
// (вверх — кольцевой бугор породы и лёгкое наслоение выброса за ним).
// Splat — разовый рендер мягкого штампа в точку эпицентра (не на кадр). Кратеры сливаются
// поканальным max (наложения дают самую глубокую воронку, а не суммарную дыру).
//
// MAX через CustomBlending+MaxEquation НЕ используем: WebGPU-бэкенд three это принимает,
// а WebGL2-бэкенд (swiftshader/headless и часть браузеров) падает с
// "INVALID_ENUM: blendEquationSeparate" — see план Task 7, фолбэк ping-pong. Вместо блендинга
// max считается прямо в шейдере штампа: он сэмплирует ПРЕДЫДУЩЕЕ поле (prevRt) и пишет
// max(prev, вклад_штампа) обычным опаковым выводом — работает на обоих бэкендах.
//
// rt — публичный, стабильный по идентичности RenderTarget (его .texture захватывается один раз
// в GlobeView/main.ts при старте) — именно в него всегда пишется актуальное поле. prevRt —
// приватный снимок состояния rt ДО текущего splat: без него пришлось бы читать и писать rt
// в одном проходе (петля обратной связи). Снимок делается дешёвым copyTextureToTexture
// (работает на обоих бэкендах, без лишнего draw call).
import type * as THREE from 'three/webgpu';
import {
  uniform,
  vec4,
  uv,
  length,
  sub,
  vec2,
  smoothstep,
  float,
  clamp,
  texture,
  max,
  sin,
  exp,
  PI,
} from 'three/tsl';
import type { ThreeCtx } from './Renderer';
import type { Vec3 } from '../sim/geo';
import { dirToLonLat } from '../sim/geo';
import {
  DAMAGE_TEX_W,
  DAMAGE_TEX_H,
  CRATER_RIM_FRAC,
  CRATER_RIM_WIDTH_FRAC,
  CRATER_EJECTA_FRAC,
  CRATER_SCORCH_FRAC,
} from '../assets/config';

const ANG_BY_YIELD: Record<number, number> = { 1: 0.03, 10: 0.05, 100: 0.09 };

// Точные типы юниформов (как в ExplosionView): конкретный overload uniform() вместо размытого
// объединения перегрузок, чтобы .value имел тип Vector2 / number, а не keyof UniformValue.
function makeVec2Uniform(v: THREE.Vector2) {
  return uniform(v);
}
function makeFloatUniform(v: number) {
  return uniform(v);
}
type Vec2Uniform = ReturnType<typeof makeVec2Uniform>;
type FloatUniform = ReturnType<typeof makeFloatUniform>;

export class DamageField {
  private readonly rt: THREE.RenderTarget; // публичное поле (стабильная идентичность .texture)
  private readonly prevRt: THREE.RenderTarget; // приватный снимок rt до текущего splat
  private readonly stampScene: THREE.Scene;
  private readonly stampCam: THREE.OrthographicCamera;
  private readonly stampMesh: THREE.Mesh;
  private readonly uCenter: Vec2Uniform;
  private readonly uRadius: FloatUniform;
  private readonly uKind: FloatUniform; // 0=land, 1=ice

  constructor(private readonly ctx: ThreeCtx) {
    const { THREE } = ctx;
    const makeRT = (): THREE.RenderTarget => {
      const rt = new THREE.RenderTarget(DAMAGE_TEX_W, DAMAGE_TEX_H, {
        depthBuffer: false,
        type: THREE.UnsignedByteType,
      });
      rt.texture.wrapS = THREE.RepeatWrapping; // корректный wrap по шву долготы
      return rt;
    };
    this.rt = makeRT();
    this.prevRt = makeRT();

    this.stampScene = new THREE.Scene();
    // Орто-камера смотрит вдоль -Z; квад лежит в плоскости z=0, камера вынесена на z=1 с запасом
    // near/far по обе стороны — иначе при near=0 квад оказывается ровно на границе отсечения
    // (риск не отрендериться из-за погрешности округления на некоторых бэкендах).
    this.stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2);
    this.stampCam.position.z = 1;

    this.uCenter = makeVec2Uniform(new THREE.Vector2(0.5, 0.5));
    this.uRadius = makeFloatUniform(0.05);
    this.uKind = makeFloatUniform(0);

    // Профиль штампа: чаша глубины по угловому расстоянию до центра. Аспект equirect 2:1 даёт
    // базовый множитель 2 по U, но у полюсов долгота «сжимается» на cos(lat) — без поправки
    // круглая воронка превращается в вытянутую к полюсу звезду. cos(lat) = sin(v·π), где
    // v = uv().y, lat = π/2 − v·π — так что множитель по U масштабируем на sin(v·π).
    const latWeight = sin(uv().y.mul(PI));
    const d = length(sub(uv(), this.uCenter).mul(vec2(float(2).mul(latWeight), 1)));
    // dNorm — та же нормировка, что и в чистом craterProfile (src/render/effects/craterProfile.ts):
    // 0 в центре, 1 на краю чаши, >1 снаружи (вал/эжекта). Формулы ниже — его TSL-зеркало.
    const dNorm = d.div(this.uRadius);
    const depth = smoothstep(float(1), float(0), dNorm); // чаша: 1 в центре → 0 на краю
    const rimX = dNorm.sub(CRATER_RIM_FRAC).div(CRATER_RIM_WIDTH_FRAC);
    const rim = exp(rimX.mul(rimX).negate()); // вал: гаусс за краем чаши
    const ejecta = smoothstep(float(CRATER_EJECTA_FRAC), float(CRATER_RIM_FRAC), dNorm);
    const scorch = smoothstep(float(CRATER_SCORCH_FRAC), float(0), dNorm); // широкая гарь
    const melt = clamp(depth.mul(this.uKind), 0, 1); // только лёд, форма как у чаши
    const stamp = vec4(
      clamp(depth, 0, 1),
      clamp(scorch, 0, 1),
      melt,
      clamp(rim.add(ejecta.mul(0.35)), 0, 1),
    );
    // Поканальный max с предыдущим состоянием поля (см. комментарий вверху файла про
    // WebGL2-несовместимость CustomBlending+MaxEquation) — обычный опаковый вывод.
    const prevSample = texture(this.prevRt.texture, uv());
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = max(prevSample, stamp);
    mat.transparent = false;

    this.stampMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.stampMesh.position.set(0.5, 0.5, 0);
    this.stampScene.add(this.stampMesh);
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  // Впечатывает воронку в поле. kind='ice' поднимает канал оплавления (полынья).
  splat(dir: Vec3, yieldMt: number, kind: 'land' | 'ice'): void {
    const { lon, lat } = dirToLonLat(dir);
    this.uCenter.value.set((lon + Math.PI) / (2 * Math.PI), (Math.PI / 2 - lat) / Math.PI);
    this.uRadius.value = ANG_BY_YIELD[yieldMt] ?? 0.05;
    this.uKind.value = kind === 'ice' ? 1 : 0;

    // Снимок текущего поля в prevRt ДО перезаписи rt — материал штампа читает именно его,
    // иначе rt читался бы и писался в одном проходе (петля обратной связи).
    this.ctx.renderer.copyTextureToTexture(this.rt.texture, this.prevRt.texture);

    const prevTarget = this.ctx.renderer.getRenderTarget();
    const prevAutoClear = this.ctx.renderer.autoClear;
    // autoClear=true (по умолчанию) заставил бы render() очистить цветовой буфер this.rt
    // перед отрисовкой штампа — весь накопленный ранее урон стирался бы на каждом splat().
    // Гасим autoClear на время рендера в rt и обязательно восстанавливаем после,
    // иначе сломается основной рендер сцены, который полагается на autoClear=true.
    this.ctx.renderer.autoClear = false;
    this.ctx.renderer.setRenderTarget(this.rt);
    this.ctx.renderer.render(this.stampScene, this.stampCam);
    this.ctx.renderer.setRenderTarget(prevTarget);
    this.ctx.renderer.autoClear = prevAutoClear;
  }

  // Полная очистка поля (planetReset) — оба буфера, иначе следующий splat подмешает
  // снимок старого prevRt.
  clear(): void {
    const prevTarget = this.ctx.renderer.getRenderTarget();
    this.ctx.renderer.setRenderTarget(this.rt);
    this.ctx.renderer.clearColor();
    this.ctx.renderer.setRenderTarget(this.prevRt);
    this.ctx.renderer.clearColor();
    this.ctx.renderer.setRenderTarget(prevTarget);
  }
}
