export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

// Детерминированный ГПСЧ (mulberry32) — воспроизводимость под реплеи и netcode.
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

// Единственный разрешённый источник времени в цикле/рендере.
export function now(): number {
  return performance.now() / 1000;
}
