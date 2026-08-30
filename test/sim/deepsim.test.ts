import { describe, it, expect } from 'vitest';
import { createEconomy, tickEconomy, economyIncome, ECONOMY_PROFILES } from '../../src/sim/economy';
import { decayIntel, effectiveKnowledge, noisyProgress } from '../../src/sim/espionage';
import {
  voteOf,
  supportFor,
  resolutionOutcome,
  hostilityOf,
  PERMANENT_MEMBERS,
  RESOLUTION_NAMES,
  type VoteContext,
} from '../../src/sim/un';
import { sponsorDesire, wantsToSponsor } from '../../src/sim/sponsorship';
import { SCENARIOS, scenarioById, isScenarioId } from '../../src/sim/scenarios';
import { FACTIONS } from '../../src/sim/factions';
import { PROGRESS_NOISE_SCALE, ESCALATION_MAX } from '../../src/assets/config';

const vote = (over: Partial<VoteContext> = {}): VoteContext => ({
  voter: 'china',
  temperament: 'balanced',
  evidence: 1,
  hostilityToTarget: 0.5,
  hostilityToProposer: 0,
  allyOfTarget: false,
  sponsorsTarget: false,
  kind: 'sanctions',
  ...over,
});

describe('Экономика', () => {
  it('у каждой стороны задан индекс, доход пропорционален ему', () => {
    for (const f of FACTIONS) expect(ECONOMY_PROFILES[f.id]).toBeGreaterThan(0);
    expect(economyIncome(1)).toBeGreaterThan(economyIncome(0.5));
    expect(economyIncome(0)).toBe(0);
  });

  it('доход копится в бюджет, санкции роняют индекс, коалиционные — сильнее', () => {
    const solo = createEconomy('iran');
    const coalition = createEconomy('iran');
    const opts = { sanctioned: true, coalition: false, ownSanctions: 0, populationFrac: 1 };
    tickEconomy(solo, 'iran', 10, opts);
    tickEconomy(coalition, 'iran', 10, { ...opts, coalition: true });
    expect(solo.budget).toBeGreaterThan(10);
    expect(coalition.economy).toBeLessThan(solo.economy);
  });

  it('инициатор платит за свои санкции, экономика восстанавливается к потолку', () => {
    const presser = createEconomy('usa');
    tickEconomy(presser, 'usa', 10, {
      sanctioned: false,
      coalition: false,
      ownSanctions: 4,
      populationFrac: 1,
    });
    expect(presser.economy).toBeLessThan(ECONOMY_PROFILES.usa);

    const hurt = createEconomy('usa');
    hurt.economy = 0.3;
    for (let i = 0; i < 50; i++) {
      tickEconomy(hurt, 'usa', 1, {
        sanctioned: false,
        coalition: false,
        ownSanctions: 0,
        populationFrac: 1,
      });
    }
    expect(hurt.economy).toBeGreaterThan(0.3);
  });

  it('погибшее население опускает потолок экономики', () => {
    const ruined = createEconomy('usa');
    for (let i = 0; i < 200; i++) {
      tickEconomy(ruined, 'usa', 1, {
        sanctioned: false,
        coalition: false,
        ownSanctions: 0,
        populationFrac: 0.2,
      });
    }
    expect(ruined.economy).toBeLessThan(0.35);
  });
});

describe('Шпионаж', () => {
  it('знание тает, но не уходит ниже нуля', () => {
    expect(decayIntel(1, 10)).toBeLessThan(1);
    expect(decayIntel(0.001, 1000)).toBe(0);
  });

  it('осведомлённость — максимум из подозрения и разведки', () => {
    expect(effectiveKnowledge(0.3, 0.8)).toBeCloseTo(0.8, 6);
    expect(effectiveKnowledge(0.9, 0.1)).toBeCloseTo(0.9, 6);
  });

  it('шум оценки ограничен, детерминирован и исчезает при полном знании', () => {
    expect(noisyProgress(0.5, 1, 7)).toBe(0.5);
    const a = noisyProgress(0.5, 0.2, 7);
    const b = noisyProgress(0.5, 0.2, 7);
    expect(a).toBe(b);
    expect(Math.abs(a - 0.5)).toBeLessThanOrEqual(PROGRESS_NOISE_SCALE + 1e-9);
    expect(noisyProgress(0.02, 0, 3)).toBeGreaterThanOrEqual(0);
    expect(noisyProgress(0.99, 0, 3)).toBeLessThanOrEqual(1);
  });
});

describe('ООН', () => {
  it('без доказательств поддержка резко падает', () => {
    expect(supportFor(vote({ evidence: 0 }))).toBeLessThan(supportFor(vote({ evidence: 1 })));
    expect(voteOf(vote({ evidence: 0, hostilityToTarget: 0 })).vote).not.toBe('for');
  });

  it('спонсор своих не сдаёт, союзник цели тоже против', () => {
    expect(voteOf(vote({ sponsorsTarget: true })).vote).toBe('against');
    expect(supportFor(vote({ allyOfTarget: true }))).toBeLessThan(supportFor(vote()));
  });

  it('инспекции поддержать легче, чем санкции', () => {
    expect(supportFor(vote({ kind: 'inspections' }))).toBeGreaterThan(
      supportFor(vote({ kind: 'sanctions' })),
    );
    for (const kind of ['sanctions', 'inspections'] as const) {
      expect(RESOLUTION_NAMES[kind].length).toBeGreaterThan(0);
    }
  });

  it('вето постоянного члена валит резолюцию даже при большинстве «за»', () => {
    const votes = [
      { voter: 'china' as const, vote: 'for' as const, support: 0.9 },
      { voter: 'india' as const, vote: 'for' as const, support: 0.8 },
      { voter: 'israel' as const, vote: 'for' as const, support: 0.7 },
      { voter: 'russia' as const, vote: 'against' as const, support: 0.1 },
    ];
    const out = resolutionOutcome(votes);
    expect(out.passed).toBe(false);
    expect(out.vetoedBy).toBe('russia');
    expect(PERMANENT_MEMBERS).toContain('russia');
  });

  it('большинство без вето — резолюция проходит', () => {
    const votes = [
      { voter: 'china' as const, vote: 'for' as const, support: 0.9 },
      { voter: 'india' as const, vote: 'for' as const, support: 0.8 },
      { voter: 'pakistan' as const, vote: 'against' as const, support: 0.2 },
    ];
    expect(resolutionOutcome(votes).passed).toBe(true);
  });

  it('накал нормализуется в 0..1', () => {
    expect(hostilityOf(0)).toBe(0);
    expect(hostilityOf(ESCALATION_MAX)).toBe(1);
    expect(hostilityOf(99)).toBe(1);
  });
});

describe('Спонсорство', () => {
  const ctx = (over = {}) => ({
    hostilityToPlayer: 0.8,
    hostilityToTarget: 0,
    targetProgress: 0.3,
    economy: 0.8,
    temperament: 'balanced' as const,
    alreadySponsored: false,
    ...over,
  });

  it('врагу игрока помогают охотнее, своего врага не вооружают', () => {
    expect(sponsorDesire(ctx())).toBeGreaterThan(sponsorDesire(ctx({ hostilityToPlayer: 0 })));
    expect(sponsorDesire(ctx({ hostilityToTarget: 1 }))).toBeLessThan(sponsorDesire(ctx()));
  });

  it('нищая держава не спонсирует, занятую программу не перехватывают', () => {
    expect(sponsorDesire(ctx({ economy: 0 }))).toBeLessThan(sponsorDesire(ctx()));
    expect(sponsorDesire(ctx({ alreadySponsored: true }))).toBe(0);
    expect(wantsToSponsor(ctx({ alreadySponsored: true }))).toBe(false);
  });

  it('ястреб щедрее голубя на чужие руки', () => {
    expect(sponsorDesire(ctx({ temperament: 'hawk' }))).toBeGreaterThan(
      sponsorDesire(ctx({ temperament: 'dove' })),
    );
  });
});

describe('Сценарии', () => {
  it('каждый сценарий описан целиком и находится по id', () => {
    for (const sc of SCENARIOS) {
      expect(sc.name.length).toBeGreaterThan(0);
      expect(sc.hint.length).toBeGreaterThan(0);
      expect(sc.influence).toBeGreaterThan(0);
      expect(isScenarioId(sc.id)).toBe(true);
      expect(scenarioById(sc.id)).toBe(sc);
    }
    expect(isScenarioId('нет такого')).toBe(false);
  });

  it('«Каскад» стартует с уже идущими программами, «Холодная война» — с кризисом', () => {
    expect(Object.keys(scenarioById('cascade').programs).length).toBeGreaterThan(0);
    expect(scenarioById('coldwar').relations.length).toBeGreaterThan(0);
    expect(scenarioById('coldwar').sponsorBias).toBeGreaterThan(
      scenarioById('fragile').sponsorBias,
    );
  });
});
