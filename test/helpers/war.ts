// Общие помощники тестов симуляции: прогон тиков, фильтр событий и поиск сида, на котором
// удар долетает (после появления ПРО боеголовку могут сбить — фиксированный сид больше не
// гарантирует прилёт).
import { Simulation } from '../../src/sim/Simulation';
import { TICK_DT } from '../../src/core/time';
import type { Command } from '../../src/sim/commands';
import type { SimEvent, FactionStat } from '../../src/sim/events';
import type { FactionId } from '../../src/sim/factions';

export function run(sim: Simulation, seconds: number, cmds: Command[] = []): SimEvent[] {
  const out: SimEvent[] = [];
  const steps = Math.ceil(seconds / TICK_DT);
  for (let i = 0; i < steps; i++) out.push(...sim.step(TICK_DT, i === 0 ? cmds : []));
  return out;
}

export const of = <K extends SimEvent['kind']>(events: SimEvent[], kind: K) =>
  events.filter((e): e is Extract<SimEvent, { kind: K }> => e.kind === kind);

export const statOf = (events: SimEvent[], id: FactionId): FactionStat | undefined =>
  of(events, 'factionsChanged')
    .at(-1)
    ?.factions.find((s) => s.id === id);

// Первый сид (из 60), на котором заданные команды приводят к настоящему взрыву.
export function strikeThatLands(
  seconds: number,
  cmds: Command[],
): { sim: Simulation; events: SimEvent[] } {
  for (let seed = 1; seed <= 60; seed++) {
    const sim = new Simulation(seed);
    const events = run(sim, seconds, cmds);
    if (of(events, 'explosionStarted').length > 0) return { sim, events };
  }
  throw new Error('не нашли сид, где удар доходит до цели');
}
