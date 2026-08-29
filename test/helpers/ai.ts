// Сборка синтетических контекстов решения для табличных тестов Utility AI.
import type { DecisionContext, RivalView, SelfView } from '../../src/sim/ai/types';
import type { FactionId } from '../../src/sim/factions';

export function rival(id: FactionId, over: Partial<RivalView> = {}): RivalView {
  return {
    id,
    level: 1,
    truce: false,
    arsenal: 20,
    interceptorsFrac: 1,
    popAliveFrac: 1,
    citiesAlive: 10,
    grievance: 0,
    offerFromThem: false,
    offerPending: false,
    peaceCooldown: false,
    ally: false,
    allyHeat: 0,
    ...over,
  };
}

export function ctx(
  self: Partial<SelfView> = {},
  rivals: RivalView[] = [rival('russia')],
  over: Partial<Pick<DecisionContext, 'doctrine' | 'ceiling'>> = {},
): DecisionContext {
  return {
    self: {
      id: 'usa',
      temperament: 'balanced',
      arsenal: 30,
      arsenalFrac: 1,
      interceptorsFrac: 1,
      damageFrac: 0,
      citiesAlive: 20,
      sinceStrike: 1e6, // по умолчанию перезарядка давно завершена
      ...self,
    },
    rivals,
    doctrine: 'restrained',
    ceiling: 2,
    ...over,
  };
}
