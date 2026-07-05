// Мост между симуляцией (SimHost) и рендер-объектами three.js. Не тянет события из host
// сам — main.ts сливает их раз за кадр через host.drainEvents() и раздаёт всем потребителям
// (Scene и Hud), поэтому Scene получает уже готовый список через handleEvents().
// Владеет MissileView/ExplosionView/ParticlePool/DecalView и звуком взрыва.
import type { ThreeCtx } from './Renderer';
import type { GlobeView } from './GlobeView';
import type { SimHost } from '../sim/SimHost';
import type { SimEvent } from '../sim/events';
import type { Vec3 } from '../sim/geo';
import type { Surface, Biome } from '../sim/material';
import type { CameraRig } from '../input/CameraRig';
import { MissileView } from './MissileView';
import { ExplosionView } from './ExplosionView';
import { ParticlePool } from './effects/particles';
import { DecalView } from './DecalView';
import type { DamageField } from './DamageField';
import { playBoom } from './effects/sound';

// Порт shake = Math.max(shake, 0.02 * ys), ys = {1:0.6, 10:1.0, 100:1.7}[yieldMt]
// (reference/earth-nuke.html ~755) — чем мощнее заряд, тем сильнее толчок камеры.
const SHAKE_SCALE_BY_YIELD: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };
const SHAKE_PER_UNIT = 0.02;

export class Scene {
  private readonly missileView: MissileView;
  private readonly explosionView: ExplosionView;
  private readonly particlePool: ParticlePool;
  private readonly decalView: DecalView;
  private clock = 0; // общие часы рендера (секунды); база спавна частиц и uTime шейдера

  // ctx/globe/host не сохраняются полями — используются только здесь, при постройке владений
  // Scene; host снова понадобится полем, когда придёт сеть/реплей (пока события идут через
  // handleEvents()). Взрыв (огненный шар/волна/частицы) крепится к globe.spinGroup, как и ракеты.
  constructor(
    ctx: ThreeCtx,
    globe: GlobeView,
    host: SimHost,
    private readonly rig: CameraRig,
    private readonly damageField: DamageField,
  ) {
    void host; // пока не используется — события приходят через handleEvents(), не через host
    this.missileView = new MissileView(ctx, globe.spinGroup);
    this.explosionView = new ExplosionView(ctx, globe.spinGroup);
    this.particlePool = new ParticlePool(ctx, globe.spinGroup);
    this.decalView = new DecalView(ctx, globe);
  }

  // Разбирает события, уже слитые из host.drainEvents() вызывающим кодом (main.ts) —
  // так один и тот же кадровый батч можно раздать и в Scene, и в Hud (Task 10) без
  // повторного drainEvents(), который необратимо опустошает буфер.
  handleEvents(events: SimEvent[]): void {
    for (const event of events) this.handleEvent(event);
  }

  private handleEvent(event: SimEvent): void {
    switch (event.kind) {
      case 'missileLaunched':
        this.missileView.spawn(event.id, event.dir, event.yield);
        break;
      case 'explosionStarted':
        this.missileView.despawn(event.id);
        this.startExplosion(event.dir, event.yield, event.seed, event.surface, event.biome);
        break;
      case 'planetReset':
        this.decalView.clear();
        this.damageField.clear();
        break;
      default:
        break; // остальные события (cityHit/statsChanged/labelsToggled/...) — забота Hud, не Scene
    }
  }

  // Запускает визуал взрыва (тряска + огненный шар/волна + частицы гриба + горячая кайма +
  // splat в поле урона + звук). Маршрутизация по surface: вода — временная заглушка (полноценный
  // WaterBurstView — Task 10), суша/лёд — прежний путь плюс splat DamageField (постоянный
  // кратер/обугливание/полынья теперь копится в поле, а не в decal-меше). Отдельный метод,
  // чтобы его мог дёрнуть и обработчик события, и (при ручной/headless-проверке) прямой вызов
  // без ожидания полёта ракеты.
  startExplosion(dir: Vec3, yieldMt: number, seed: number, surface: Surface, biome: Biome): void {
    this.triggerShake(yieldMt);
    if (surface === 'water') {
      // TODO(Task 10): WaterBurstView — пока переиспользуем наземный взрыв как заглушку.
      this.explosionView.spawn(dir, yieldMt, seed);
    } else {
      void biome; // тон пыли по биому — Task 10 (пока particlePool.emit не принимает biome)
      this.explosionView.spawn(dir, yieldMt, seed);
      this.particlePool.emit(dir, yieldMt, seed, this.clock);
      this.decalView.spawn(dir, yieldMt, seed);
      this.damageField.splat(dir, yieldMt, surface === 'ice' ? 'ice' : 'land');
    }
    playBoom(yieldMt);
  }

  private triggerShake(yieldMt: number): void {
    const ys = SHAKE_SCALE_BY_YIELD[yieldMt] ?? 1;
    this.rig.shake = Math.max(this.rig.shake, SHAKE_PER_UNIT * ys);
  }

  // Двигает вьюхи на dt секунд реального времени (вызывается из render-колбэка GameLoop).
  update(dt: number): void {
    this.clock += dt;
    this.missileView.update(dt);
    this.explosionView.update(dt);
    this.particlePool.setTime(this.clock);
    this.decalView.update(dt);
  }
}
