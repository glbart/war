// Сценарии кампании (спека 2026-08-29-deep-simulation §7): стартовые условия партии.
// Данные, а не код: сценарий — это набор правок начального состояния.

import type { Doctrine } from './diplomacy';
import type { FactionId } from './factions';
import type { ProgramStage } from './proliferation';

export type ScenarioId = 'fragile' | 'cascade' | 'coldwar';

export interface ScenarioProgramSetup {
  stage: ProgramStage;
  progress?: number;
  motivation?: number;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  hint: string;
  doctrine: Doctrine;
  influence: number; // стартовое влияние игрока
  programs: Partial<Record<FactionId, ScenarioProgramSetup>>;
  relations: { a: FactionId; b: FactionId; level: number }[]; // стартовые ступени эскалации
  sponsorBias: number; // прибавка к желанию держав спонсировать чужие программы
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'fragile',
    name: 'Хрупкий мир',
    hint: 'Программы только начинаются. Времени хватает, если не зевать.',
    doctrine: 'restrained',
    influence: 60,
    programs: {},
    relations: [],
    sponsorBias: 0,
  },
  {
    id: 'cascade',
    name: 'Каскад',
    hint: 'Иран и Саудовская Аравия уже обогащают. Мир на грани цепной реакции.',
    doctrine: 'escalate',
    influence: 80,
    programs: {
      iran: { stage: 'enrichment', progress: 0.5, motivation: 0.85 },
      saudi: { stage: 'enrichment', progress: 0.2, motivation: 0.7 },
      turkey: { stage: 'research', progress: 0.4, motivation: 0.55 },
    },
    relations: [],
    sponsorBias: 0.1,
  },
  {
    id: 'coldwar',
    name: 'Холодная война',
    hint: 'Россия и Китай в кризисе с вами и охотно кормят чужие программы. Влияния мало.',
    doctrine: 'escalate',
    influence: 40,
    programs: {
      iran: { stage: 'research', progress: 0.6, motivation: 0.8 },
    },
    relations: [
      { a: 'usa', b: 'russia', level: 1 },
      { a: 'usa', b: 'china', level: 1 },
    ],
    sponsorBias: 0.25,
  },
];

export const DEFAULT_SCENARIO: ScenarioId = 'fragile';

export function scenarioById(id: ScenarioId): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && SCENARIOS.some((s) => s.id === v);
}
