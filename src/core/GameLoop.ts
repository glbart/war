import { now, TICK_DT } from './time';

// Фиксированный таймстеп для симуляции + свободный рендер. Аккумулятор гасит спайки.
export class GameLoop {
  private running = false;
  private last = 0;
  private acc = 0;
  private raf = 0;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (dt: number) => void,
  ) {}

  start(): void {
    this.running = true;
    this.last = now();
    const tick = () => {
      if (!this.running) return;
      const t = now();
      let frame = t - this.last;
      this.last = t;
      if (frame > 0.25) frame = 0.25; // защита от «дьявольской спирали»
      this.acc += frame;
      while (this.acc >= TICK_DT) {
        this.step(TICK_DT);
        this.acc -= TICK_DT;
      }
      this.render(frame);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
