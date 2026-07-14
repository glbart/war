// Мост между симуляцией (SimHost) и рендер-объектами three.js. Не тянет события из host
// сам — main.ts сливает их раз за кадр через host.drainEvents() и раздаёт всем потребителям
// (Scene и Hud), поэтому Scene получает уже готовый список через handleEvents().
// Владеет MissileView/ExplosionView/WaterBurstView/ParticlePool/EjectaView/DecalView и звуком взрыва.
import type { ThreeCtx } from './Renderer';
import type { GlobeView } from './GlobeView';
import type { SimHost } from '../sim/SimHost';
import type { SimEvent } from '../sim/events';
import type { Vec3 } from '../sim/geo';
import type { Surface, Biome } from '../sim/material';
import type { CameraRig } from '../input/CameraRig';
import { MissileView } from './MissileView';
import { ExplosionView } from './ExplosionView';
import { WaterBurstView } from './WaterBurstView';
import { ParticlePool } from './effects/particles';
import { EjectaView } from './EjectaView';
import { DebrisView } from './DebrisView';
import { DecalView } from './DecalView';
import type { DamageField } from './DamageField';
import { WaterField } from './WaterField';
import { OceanShell } from './OceanShell';
import { buildCoastTexture } from './CoastField';
import { Crust, crackStrengthForDepth } from '../crust/Crust';
import { CrustView } from './CrustView';
import { MagmaCore } from './MagmaCore';
import type { HoleMask } from './HoleMask';
import { playBoom } from './effects/sound';
import {
  WATER_SPLAT_STRENGTH,
  WATER_SPLAT_RADIUS,
  CRUST_RADIUS_BY_YIELD,
  CRUST_DEPTH_BY_YIELD,
  DEBRIS_PUFF_MAX,
} from '../assets/config';

// Порт shake = Math.max(shake, 0.02 * ys), ys = {1:0.6, 10:1.0, 100:1.7}[yieldMt]
// (reference/earth-nuke.html ~755) — чем мощнее заряд, тем сильнее толчок камеры.
const SHAKE_SCALE_BY_YIELD: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };
const SHAKE_PER_UNIT = 0.02;

export class Scene {
  private readonly missileView: MissileView;
  private readonly explosionView: ExplosionView;
  private readonly waterBurstView: WaterBurstView;
  private readonly particlePool: ParticlePool;
  private readonly ejectaView: EjectaView;
  private readonly debrisView: DebrisView;
  private readonly decalView: DecalView;
  private readonly waterField: WaterField;
  private readonly oceanShell: OceanShell;
  private readonly crust: Crust;
  private readonly crustView: CrustView;
  private readonly magma: MagmaCore;
  private clock = 0; // общие часы рендера (секунды); база спавна частиц и uTime шейдера
  private readonly globe: GlobeView; // нужен полем: часы пульса трещин (globe.setTime в update)

  // ctx/host не сохраняются полями — используются только здесь, при постройке владений
  // Scene; host снова понадобится полем, когда придёт сеть/реплей (пока события идут через
  // handleEvents()). Взрыв (огненный шар/волна/частицы) крепится к globe.spinGroup, как и ракеты.
  constructor(
    ctx: ThreeCtx,
    globe: GlobeView,
    host: SimHost,
    private readonly rig: CameraRig,
    private readonly damageField: DamageField,
    private readonly holeMask: HoleMask,
  ) {
    void host; // пока не используется — события приходят через handleEvents(), не через host
    this.globe = globe;
    this.missileView = new MissileView(ctx, globe.spinGroup);
    this.explosionView = new ExplosionView(ctx, globe.spinGroup);
    this.waterBurstView = new WaterBurstView(ctx, globe.spinGroup);
    this.particlePool = new ParticlePool(ctx, globe.spinGroup);
    this.ejectaView = new EjectaView(ctx, globe.spinGroup);
    this.debrisView = new DebrisView(ctx, globe.spinGroup);
    this.decalView = new DecalView(ctx, globe);
    // Интерактивная вода: поле волн + маска берега + анимированная оболочка над глобусом.
    this.waterField = new WaterField(ctx);
    const coastTex = buildCoastTexture(ctx);
    this.oceanShell = new OceanShell(ctx, globe.spinGroup, this.waterField.texture, coastTex);
    // Воксельная кора: состояние + гибрид-рендер + магма-подложка (спека 2026-07-06).
    this.crust = new Crust();
    this.magma = new MagmaCore(ctx, globe.spinGroup);
    this.crustView = new CrustView(
      ctx,
      globe.spinGroup,
      this.crust,
      globe.biomeTexture,
      damageField.texture,
    );
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
        this.waterField.clear();
        this.crust.reset();
        this.crustView.clear();
        this.holeMask.clear();
        this.debrisView.clear();
        break;
      default:
        break; // остальные события (cityHit/statsChanged/labelsToggled/...) — забота Hud, не Scene
    }
  }

  // Запускает визуал взрыва (тряска + звук + маршрутизация по surface). Вода — купол брызг/
  // столб/пенное кольцо (WaterBurstView), без DamageField (вода смыкается, следа нет); суша/лёд —
  // огненный шар/волна + частицы гриба + горячая кайма + splat DamageField (постоянный кратер/
  // обугливание/полынья копится в поле, а не в decal-меше). Отдельный метод, чтобы его мог дёрнуть
  // и обработчик события, и (при ручной/headless-проверке) прямой вызов без ожидания полёта ракеты.
  startExplosion(dir: Vec3, yieldMt: number, seed: number, surface: Surface, biome: Biome): void {
    this.triggerShake(yieldMt);
    if (surface === 'water') {
      // Только волны: рябь/каверна в поле (WaterField) → анимированная OceanShell. Старый купол/
      // столб/кольцо (WaterBurstView) убран — вода реагирует волнами, без «конуса».
      this.waterField.splat(
        dir,
        WATER_SPLAT_STRENGTH[yieldMt] ?? 1,
        WATER_SPLAT_RADIUS[yieldMt] ?? 0.02,
      );
    } else {
      void biome; // тон пыли по биому — отложено (Task 10): particlePool.emit его не принимает
      this.explosionView.spawn(dir, yieldMt, seed);
      this.particlePool.emit(dir, yieldMt, seed, this.clock);
      this.ejectaView.emit(dir, yieldMt, seed, this.clock);
      this.decalView.spawn(dir, yieldMt, seed);
      // Выгрызаем кору ДО splat поля урона: глубина пробития (deepestLayer) определяет силу
      // трещинного очага, который splat пишет в R-канал (этап 3).
      const carved = this.crust.carve(
        dir,
        CRUST_RADIUS_BY_YIELD[yieldMt] ?? 0.02,
        CRUST_DEPTH_BY_YIELD[yieldMt] ?? 3,
        seed,
      );
      this.crustView.update(carved.changed);
      this.damageField.splat(
        dir,
        yieldMt,
        surface === 'ice' ? 'ice' : 'land',
        crackStrengthForDepth(carved.deepestLayer),
      );
      // Дискард глобуса — по ДИСКУ реального карва (не по AABB чанка): см. HoleMask.markCarve
      this.holeMask.markCarve(dir, CRUST_RADIUS_BY_YIELD[yieldMt] ?? 0.02);
      // Глыбы выбитой породы: разлёт + пополнение орбитального кольца (этап 2, спека
      // 2026-07-14). Приземления баллистических глыб — отложенные пыхи пыли (лимит
      // DEBRIS_PUFF_MAX бережёт кольцевой буфер EjectaView от вытеснения частиц гриба).
      const landings = this.debrisView.emit(dir, yieldMt, seed, this.clock, carved.removedByMat);
      const puffs = Math.min(landings.length, DEBRIS_PUFF_MAX);
      for (let i = 0; i < puffs; i++) {
        const l = landings[i];
        if (l) this.ejectaView.emitPuff(l.dir, l.at, seed + i * 7 + 1);
      }
    }
    playBoom(yieldMt);
  }

  private triggerShake(yieldMt: number): void {
    const ys = SHAKE_SCALE_BY_YIELD[yieldMt] ?? 1;
    this.rig.shake = Math.max(this.rig.shake, SHAKE_PER_UNIT * ys);
  }

  // Dev-зонды поля воды (только для dev-хуков, см. src/debug/devHooks.ts).
  debugWaterFill(value: number): void {
    this.waterField.debugFill(value);
  }

  debugWaterStats(
    which: 'stable' | 'sim' = 'stable',
  ): Promise<{ hMin: number; hMax: number; vMin: number; vMax: number }> {
    return this.waterField.debugStats(which);
  }

  // Двигает вьюхи на dt секунд реального времени (вызывается из render-колбэка GameLoop).
  update(dt: number): void {
    this.clock += dt;
    this.waterField.step(dt);
    this.oceanShell.setTime(this.clock);
    this.missileView.update(dt);
    this.explosionView.update(dt);
    this.waterBurstView.update(dt);
    this.particlePool.setTime(this.clock);
    this.ejectaView.setTime(this.clock);
    this.debrisView.setTime(this.clock);
    this.decalView.update(dt);
    this.magma.setTime(this.clock);
    this.globe.setTime(this.clock);
    this.crustView.setTime(this.clock);
  }

  // Целостность коры [0..1] — для HUD (main.ts опрашивает раз за кадр).
  get crustIntegrity(): number {
    return this.crust.integrity();
  }
}
