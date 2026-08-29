import { describe, it, expect } from 'vitest';
import {
  createProgram,
  programRate,
  advanceProgram,
  totalProgress,
  isRevealed,
  motivationDrift,
  treatyAcceptance,
  setbackByStrike,
  setbackByFraction,
  ASPIRANT_PROFILES,
  STAGE_ORDER,
  STAGE_NAMES,
  type Program,
} from '../../src/sim/proliferation';
import { ASPIRANTS } from '../../src/sim/factions';
import {
  SANCTION_SLOWDOWN,
  SUSPICION_REVEAL,
  PROGRAM_START_MOTIVATION,
} from '../../src/assets/config';

const prog = (over: Partial<Program> = {}): Program => ({
  ...createProgram('iran', ASPIRANT_PROFILES.iran!),
  stage: 'research',
  motivation: 0.6,
  capacity: 0.6,
  ...over,
});

describe('Профили претендентов', () => {
  it('у каждой страны-претендента есть профиль программы и название стадий', () => {
    for (const f of ASPIRANTS) {
      expect(ASPIRANT_PROFILES[f.id], f.name).toBeDefined();
      expect(ASPIRANT_PROFILES[f.id]!.capacity).toBeGreaterThan(0);
    }
    for (const stage of STAGE_ORDER) expect(STAGE_NAMES[stage].length).toBeGreaterThan(0);
  });
});

describe('Скорость программы', () => {
  it('договор останавливает работы полностью, санкции режут темп', () => {
    expect(programRate(prog({ treaty: 10 }))).toBe(0);
    const free = programRate(prog());
    const sanctioned = programRate(prog({ sanctions: 10 }));
    expect(sanctioned).toBeCloseTo(free * SANCTION_SLOWDOWN, 6);
  });

  it('мотивация и потенциал — множители, армейская стадия уже никуда не движется', () => {
    expect(programRate(prog({ motivation: 0.8 }))).toBeGreaterThan(
      programRate(prog({ motivation: 0.4 })),
    );
    expect(programRate(prog({ capacity: 0.9 }))).toBeGreaterThan(
      programRate(prog({ capacity: 0.3 })),
    );
    expect(programRate(prog({ stage: 'armed' }))).toBe(0);
  });

  it('без мотивации страна даже не начинает программу', () => {
    const idle = prog({ stage: 'none', motivation: PROGRAM_START_MOTIVATION - 0.05 });
    expect(programRate(idle)).toBe(0);
    advanceProgram(idle, 10);
    expect(idle.stage).toBe('none');
  });
});

describe('Ход программы', () => {
  it('стадии проходятся по порядку и заканчиваются испытанием ровно один раз', () => {
    const p = prog({ stage: 'none', motivation: 1, capacity: 1 });
    const seen: string[] = [];
    let tests = 0;
    for (let i = 0; i < 400; i++) {
      if (advanceProgram(p, 1)) tests++;
      if (seen.at(-1) !== p.stage) seen.push(p.stage);
    }
    expect(seen).toEqual(['research', 'enrichment', 'weapon', 'armed']);
    expect(tests).toBe(1);
    expect(totalProgress(p)).toBe(1);
  });

  it('подозрение растёт вместе с прогрессом и раскрывает программу', () => {
    const p = prog({ motivation: 1, capacity: 1 });
    expect(isRevealed(p)).toBe(false);
    for (let i = 0; i < 60; i++) advanceProgram(p, 1);
    expect(p.suspicion).toBeGreaterThan(SUSPICION_REVEAL);
    expect(isRevealed(p)).toBe(true);
  });

  it('санкции и договор тают со временем', () => {
    const p = prog({ sanctions: 3, treaty: 2 });
    advanceProgram(p, 5);
    expect(p.sanctions).toBe(0);
    expect(p.treaty).toBe(0);
  });
});

describe('Мотивация', () => {
  it('угроза поднимает, договор опускает, значение остаётся в 0..1', () => {
    const p = prog({ motivation: 0.5 });
    expect(motivationDrift(p, 0.5, 1, 10)).toBeGreaterThan(0.5);
    const treaty = prog({ motivation: 0.5, treaty: 100 });
    expect(motivationDrift(treaty, 0.5, 0, 10)).toBeLessThan(0.5);
    for (const threat of [0, 0.5, 1]) {
      const v = motivationDrift(prog({ motivation: 0.99 }), 1, threat, 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('Договор', () => {
  it('спокойная страна на ранней стадии соглашается охотнее', () => {
    const calm = treatyAcceptance(prog({ motivation: 0.2, stage: 'research', progress: 0 }));
    const eager = treatyAcceptance(prog({ motivation: 0.9, stage: 'research', progress: 0 }));
    const late = treatyAcceptance(prog({ motivation: 0.2, stage: 'weapon', progress: 0.8 }));
    expect(calm).toBeGreaterThan(eager);
    expect(calm).toBeGreaterThan(late);
  });

  it('санкции повышают сговорчивость, значение остаётся вероятностью', () => {
    const base = prog({ motivation: 0.3 });
    const pressed = prog({ motivation: 0.3, sanctions: 50 });
    expect(treatyAcceptance(pressed)).toBeGreaterThanOrEqual(treatyAcceptance(base));
    expect(treatyAcceptance(pressed)).toBeLessThanOrEqual(0.95);
  });
});

describe('Откаты', () => {
  it('удар отбрасывает на стадию назад, но не трогает пустую программу и готовую бомбу', () => {
    const p = prog({ stage: 'weapon', progress: 0.7 });
    setbackByStrike(p);
    expect(p.stage).toBe('enrichment');
    expect(p.progress).toBe(0);

    const none = prog({ stage: 'none' });
    setbackByStrike(none);
    expect(none.stage).toBe('none');

    const armed = prog({ stage: 'armed' });
    setbackByStrike(armed);
    expect(armed.stage).toBe('armed');
  });

  it('саботаж откатывает прогресс, перетекая через границу стадий и не уходя ниже старта', () => {
    const p = prog({ stage: 'enrichment', progress: 0.2 });
    setbackByFraction(p, 0.5);
    expect(p.stage).toBe('research');
    expect(p.progress).toBeCloseTo(0.7, 6);

    const early = prog({ stage: 'research', progress: 0.1 });
    setbackByFraction(early, 0.9);
    expect(early.stage).toBe('research');
    expect(early.progress).toBe(0);
  });
});
