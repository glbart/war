import { describe, it, expect } from 'vitest';
import { POWER_BRIEFS, TOOL_BRIEFS, RULES, type PlayablePowerId } from '../../src/assets/briefing';
import { NUCLEAR_POWERS } from '../../src/sim/factions';
import {
  COST_GUARANTEE,
  COST_INSPECT,
  COST_RECON,
  COST_RESOLUTION,
  COST_SABOTAGE,
  COST_SANCTIONS,
  COST_TREATY,
  PROLIF_LOSS_COUNT,
} from '../../src/assets/config';

describe('брифинг: описания сторон', () => {
  it('описание есть у каждой играбельной державы и ни у кого лишнего', () => {
    const briefed = Object.keys(POWER_BRIEFS).sort();
    const powers = NUCLEAR_POWERS.map((f) => f.id).sort();
    expect(briefed).toEqual(powers);
  });

  it('описания непустые и осмысленной длины', () => {
    for (const [id, brief] of Object.entries(POWER_BRIEFS)) {
      expect(brief.blurb.length, id).toBeGreaterThan(20);
      expect(['лёгкая', 'средняя', 'трудная']).toContain(brief.difficulty);
    }
  });

  it('есть стороны каждой сложности — выбор в меню действительно есть', () => {
    const levels = new Set(
      Object.values(POWER_BRIEFS).map((b) => b.difficulty as PlayablePowerId | string),
    );
    expect(levels.size).toBe(3);
  });
});

describe('брифинг: инструменты влияния', () => {
  it('идентификаторы уникальны', () => {
    const ids = TOOL_BRIEFS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('покрыты все восемь инструментов HUD', () => {
    expect(TOOL_BRIEFS.map((t) => t.id).sort()).toEqual(
      [
        'guarantee',
        'inspect',
        'recon',
        'res-inspect',
        'res-sanctions',
        'sabotage',
        'sanctions',
        'treaty',
      ].sort(),
    );
  });

  it('цены совпадают с константами тюнинга (а не переписаны числами)', () => {
    const cost = (id: string) => TOOL_BRIEFS.find((t) => t.id === id)!.cost;
    expect(cost('treaty')).toBe(COST_TREATY);
    expect(cost('sanctions')).toBe(COST_SANCTIONS);
    expect(cost('inspect')).toBe(COST_INSPECT);
    expect(cost('sabotage')).toBe(COST_SABOTAGE);
    expect(cost('recon')).toBe(COST_RECON);
    expect(cost('guarantee')).toBe(COST_GUARANTEE);
    expect(cost('res-sanctions')).toBe(COST_RESOLUTION);
    expect(cost('res-inspect')).toBe(COST_RESOLUTION);
  });

  it('у каждого инструмента есть иконка, имя, «что делает» и «когда»', () => {
    for (const t of TOOL_BRIEFS) {
      expect(t.icon.length, t.id).toBeGreaterThan(0);
      expect(t.name.length, t.id).toBeGreaterThan(2);
      expect(t.what.length, t.id).toBeGreaterThan(20);
      expect(t.when.length, t.id).toBeGreaterThan(20);
    }
  });
});

describe('брифинг: справка', () => {
  it('разделы непустые и с пунктами', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(4);
    for (const s of RULES) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.items.length).toBeGreaterThan(0);
      for (const i of s.items) expect(i.length).toBeGreaterThan(10);
    }
  });

  it('условие поражения названо числом из конфига', () => {
    const text = RULES.flatMap((s) => s.items).join(' ');
    expect(text).toContain(String(PROLIF_LOSS_COUNT));
  });

  it('управление объяснено: карта, пауза и справка', () => {
    const text = RULES.flatMap((s) => s.items).join(' ');
    for (const key of ['M —', 'Esc', 'H —', 'Shift+клик']) expect(text).toContain(key);
  });
});
