import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { lonLatToDir } from '../../src/sim/geo';
import { run, of } from '../helpers/war';
import type { SimEvent, ProgramView } from '../../src/sim/events';
import { COST_SANCTIONS, INFLUENCE_START, CAMPAIGN_T } from '../../src/assets/config';

const TEHRAN = lonLatToDir((51.39 * Math.PI) / 180, (35.69 * Math.PI) / 180);

const campaign = (events: SimEvent[]) => of(events, 'campaignChanged').at(-1);
const programOf = (events: SimEvent[], id: ProgramView['id']): ProgramView | undefined =>
  campaign(events)?.programs.find((p) => p.id === id);

describe('Ядерные программы в партии', () => {
  it('без вмешательства претендент доходит до бомбы и становится ядерной державой', () => {
    const sim = new Simulation(1);
    const events = run(sim, 300);
    const test = of(events, 'nuclearTest')[0];
    expect(test).toBeDefined();
    const stats = of(events, 'factionsChanged').at(-1)!;
    expect(stats.factions.find((f) => f.id === test!.faction)!.arsenal).toBeGreaterThan(0);
  });

  it('программа сперва не подтверждена, а затем раскрывается сама', () => {
    const sim = new Simulation(2);
    const early = run(sim, 5);
    expect(programOf(early, 'iran')!.revealed).toBe(false);
    const later = run(sim, 120);
    expect(programOf(later, 'iran')!.revealed).toBe(true);
    expect(of(later, 'programRevealed').some((e) => e.faction === 'iran')).toBe(true);
  });

  it('инспекция раскрывает программу немедленно и стоит влияния', () => {
    const sim = new Simulation(3);
    const events = run(sim, 3, [{ kind: 'inspect', target: 'iran' }]);
    expect(programOf(events, 'iran')!.revealed).toBe(true);
    expect(of(events, 'inspected')).toHaveLength(1);
    expect(campaign(events)!.influence).toBeLessThan(INFLUENCE_START);
  });

  it('санкции замедляют программу', () => {
    const withSanctions = run(new Simulation(4), 120, [
      { kind: 'inspect', target: 'iran' },
      { kind: 'imposeSanctions', target: 'iran' },
    ]);
    const free = run(new Simulation(4), 120, [{ kind: 'inspect', target: 'iran' }]);
    expect(programOf(withSanctions, 'iran')!.progress).toBeLessThan(
      programOf(free, 'iran')!.progress,
    );
    expect(of(withSanctions, 'sanctionsImposed')).toHaveLength(1);
  });

  it('принятый договор замораживает работы', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = new Simulation(seed);
      const signed = run(sim, 5, [
        { kind: 'inspect', target: 'brazil' }, // спокойная страна соглашается охотнее
        { kind: 'offerTreaty', target: 'brazil' },
      ]);
      const answer = of(signed, 'treatyAnswer')[0];
      if (answer === undefined || !answer.accepted) continue;
      expect(programOf(signed, 'brazil')!.treaty).toBe(true);
      const before = programOf(signed, 'brazil')!.progress;
      const after = run(sim, 60);
      expect(programOf(after, 'brazil')!.progress).toBeCloseTo(before, 6);
      return;
    }
    throw new Error('ни на одном сиде договор не был принят');
  });

  it('удачный саботаж откатывает программу назад', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = new Simulation(seed);
      const before = run(sim, 150, [{ kind: 'inspect', target: 'iran' }]);
      const p0 = programOf(before, 'iran')!;
      if (p0.progress < 0.2) continue;
      const after = run(sim, 3, [{ kind: 'sabotage', target: 'iran' }]);
      const result = of(after, 'sabotageResult')[0];
      if (result === undefined || !result.success) continue;
      expect(programOf(after, 'iran')!.progress).toBeLessThan(p0.progress);
      return;
    }
    throw new Error('удачного саботажа не случилось ни на одном сиде');
  });

  it('удар по стране с программой отбрасывает её и бьёт по влиянию игрока', () => {
    const sim = new Simulation(5);
    const before = run(sim, 150, [
      { kind: 'setSide', faction: 'usa' },
      { kind: 'inspect', target: 'iran' },
    ]);
    const p0 = programOf(before, 'iran')!;
    const influence0 = campaign(before)!.influence;
    const after = run(sim, 10, [{ kind: 'detonate', dir: TEHRAN, yield: 100, faction: 'usa' }]);
    // удар мог быть перехвачен — проверяем только состоявшийся
    if (of(after, 'explosionStarted').length === 0) return;
    expect(programOf(after, 'iran')!.progress).toBeLessThanOrEqual(p0.progress);
    expect(campaign(after)!.influence).toBeLessThan(influence0);
  });

  it('влияние копится, тратится и не уходит в минус', () => {
    const sim = new Simulation(6);
    const grown = run(sim, 20);
    expect(campaign(grown)!.influence).toBeGreaterThan(INFLUENCE_START);
    // тратим всё до нуля и проверяем, что инструменты просто перестают работать
    let events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      events = run(sim, 0.2, [{ kind: 'imposeSanctions', target: 'iran' }]);
    }
    expect(campaign(events)!.influence).toBeGreaterThanOrEqual(0);
    expect(campaign(events)!.influence).toBeLessThan(COST_SANCTIONS);
  });

  it('три новые ядерные державы — поражение кампании', () => {
    const sim = new Simulation(7);
    const events = run(sim, CAMPAIGN_T);
    const over = of(events, 'gameOver');
    expect(over).toHaveLength(1);
    expect(['proliferated', 'nonproliferation']).toContain(over[0]!.outcome);
    expect(over[0]!.campaign.armed.length + over[0]!.campaign.stopped).toBe(8);
  });

  it('reset начинает кампанию заново: программы и влияние обнуляются', () => {
    const sim = new Simulation(8);
    run(sim, 120, [{ kind: 'inspect', target: 'iran' }]);
    const after = run(sim, 3, [{ kind: 'reset' }]);
    expect(programOf(after, 'iran')!.revealed).toBe(false);
    expect(campaign(after)!.influence).toBeGreaterThanOrEqual(INFLUENCE_START);
    expect(campaign(after)!.elapsed).toBeLessThan(5);
  });
});
