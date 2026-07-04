// Мост между симуляцией (SimHost) и рендер-объектами three.js. Не тянет события из host
// сам — main.ts сливает их раз за кадр через host.drainEvents() и раздаёт всем потребителям
// (Scene и позже Hud), поэтому Scene получает уже готовый список через handleEvents().
// Пока владеет только MissileView; ExplosionView/DecalView добавятся в Task 9-10.
import type { ThreeCtx } from './Renderer';
import type { GlobeView } from './GlobeView';
import type { SimHost } from '../sim/SimHost';
import type { SimEvent } from '../sim/events';
import type { CameraRig } from '../input/CameraRig';
import { MissileView } from './MissileView';

// Порт shake = Math.max(shake, 0.02 * ys), ys = {1:0.6, 10:1.0, 100:1.7}[yieldMt]
// (reference/earth-nuke.html ~755) — чем мощнее заряд, тем сильнее толчок камеры.
const SHAKE_SCALE_BY_YIELD: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };
const SHAKE_PER_UNIT = 0.02;

export class Scene {
  private readonly missileView: MissileView;

  // ctx/globe/host не сохраняются полями — используются только здесь, при постройке владений
  // Scene; globe/host снова понадобятся полями, когда добавятся Explosion/Decal (Task 9-10).
  constructor(
    ctx: ThreeCtx,
    globe: GlobeView,
    host: SimHost,
    private readonly rig: CameraRig,
  ) {
    void host; // пока не используется — события приходят через handleEvents(), не через host
    this.missileView = new MissileView(ctx, globe.spinGroup);
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
        this.triggerShake(event.yield);
        break;
      default:
        break; // остальные события (cityHit/statsChanged/...) — забота Hud, не Scene
    }
  }

  private triggerShake(yieldMt: number): void {
    const ys = SHAKE_SCALE_BY_YIELD[yieldMt] ?? 1;
    this.rig.shake = Math.max(this.rig.shake, SHAKE_PER_UNIT * ys);
  }

  // Двигает вьюхи на dt секунд реального времени (вызывается из render-колбэка GameLoop).
  update(dt: number): void {
    this.missileView.update(dt);
  }
}
