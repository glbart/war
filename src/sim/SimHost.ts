import type { Command } from './commands';
import type { SimEvent } from './events';
import { Simulation } from './Simulation';

// Абстракция хоста симуляции: единая точка входа/выхода команд и событий.
// Позволяет заменить локальный запуск сетевым хостом без изменения вызывающего кода.
export interface SimHost {
  post(cmd: Command): void;
  drainEvents(): SimEvent[];
  step(dt: number): void;
}

// Локальный хост: симуляция выполняется в этом же процессе, команды буферизуются
// между тиками, события накапливаются до вызова drainEvents().
export class LocalSimHost implements SimHost {
  private readonly sim: Simulation;
  private pending: Command[] = [];
  private events: SimEvent[] = [];

  constructor(seed: number) {
    this.sim = new Simulation(seed);
  }

  post(cmd: Command): void {
    this.pending.push(cmd);
  }

  step(dt: number): void {
    const cmds = this.pending;
    this.pending = [];
    this.events.push(...this.sim.step(dt, cmds));
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
