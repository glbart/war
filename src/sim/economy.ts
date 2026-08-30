// Экономика стран (спека 2026-08-29-deep-simulation-design.md §2): индекс развития даёт
// доход, доход копится в бюджет, бюджет кормит ядерную программу. Чистые данные и формулы.

import {
  ECONOMY_INCOME,
  ECONOMY_RECOVERY,
  SANCTION_ECONOMY_HIT,
  SANCTION_SELF_COST,
  COALITION_SANCTION_FACTOR,
} from '../assets/config';
import type { FactionId } from './factions';

export interface EconomyState {
  economy: number; // индекс 0..1
  budget: number; // накопленные средства
}

// Стартовые индексы: развитые экономики богаче, но это не про «хорошо/плохо», а про то,
// кто быстрее платит за свои программы и кто больнее переносит санкции.
export const ECONOMY_PROFILES: Record<FactionId, number> = {
  usa: 1.0,
  russia: 0.55,
  china: 0.85,
  europe: 0.9,
  india: 0.5,
  pakistan: 0.25,
  dprk: 0.12,
  israel: 0.6,
  iran: 0.35,
  saudi: 0.55,
  turkey: 0.45,
  egypt: 0.3,
  japan: 0.9,
  korea: 0.75,
  brazil: 0.5,
  safrica: 0.35,
  neutral: 0.5,
};

export function createEconomy(id: FactionId): EconomyState {
  return { economy: ECONOMY_PROFILES[id], budget: 10 };
}

export function economyIncome(economy: number): number {
  return ECONOMY_INCOME * Math.max(0, economy);
}

// Шаг экономики: доход в бюджет, урон от санкций, стоимость собственных санкций и
// восстановление к потолку. Потолок опущен войной: сколько населения потеряно, столько же
// экономики недоступно.
export function tickEconomy(
  st: EconomyState,
  id: FactionId,
  dt: number,
  opts: {
    sanctioned: boolean;
    coalition: boolean;
    ownSanctions: number; // сколько санкций сторона держит против других
    populationFrac: number; // доля выжившего населения 0..1
  },
): void {
  st.budget += economyIncome(st.economy) * dt;

  if (opts.sanctioned) {
    st.economy -= SANCTION_ECONOMY_HIT * (opts.coalition ? COALITION_SANCTION_FACTOR : 1) * dt;
  }
  st.economy -= SANCTION_SELF_COST * opts.ownSanctions * dt;

  const ceiling = ECONOMY_PROFILES[id] * Math.max(0, Math.min(1, opts.populationFrac));
  st.economy += (ceiling - st.economy) * ECONOMY_RECOVERY * dt;
  st.economy = Math.max(0, Math.min(1, st.economy));
}
