// Спонсорство чужих программ (спека 2026-08-29-deep-simulation §5): держава, враждебная
// игроку, может подкармливать претендента — деньгами и технологиями. Так у игрока появляется
// живой соперник, а не только часы.

import { SPONSOR_MIN_DESIRE } from '../assets/config';
import type { Temperament } from './diplomacy';

export interface SponsorContext {
  hostilityToPlayer: number; // 0..1 — накал спонсора с игроком
  hostilityToTarget: number; // 0..1 — накал спонсора с подопечным (мешает помогать)
  targetProgress: number; // 0..1 — насколько программа уже продвинута
  economy: number; // 0..1 — на щедрость нужны деньги
  temperament: Temperament;
  alreadySponsored: boolean; // кто-то уже кормит эту программу
}

// Желание спонсировать 0..1. Врагу моего врага помогают охотнее; своих врагов не вооружают;
// нищая держава не спонсирует; ястребы щедрее на чужие руки.
export function sponsorDesire(ctx: SponsorContext): number {
  if (ctx.alreadySponsored) return 0;
  let d = ctx.hostilityToPlayer * 0.7;
  d += (1 - ctx.hostilityToTarget) * 0.2;
  d += ctx.economy * 0.2;
  d += ctx.targetProgress * 0.1; // почти готовую программу выгоднее дожать
  if (ctx.temperament === 'hawk') d += 0.1;
  if (ctx.temperament === 'dove') d -= 0.15;
  return Math.max(0, Math.min(1, d));
}

export function wantsToSponsor(ctx: SponsorContext): boolean {
  return sponsorDesire(ctx) >= SPONSOR_MIN_DESIRE;
}
