// ООН: резолюции и голосование ядерных держав (спека 2026-08-29-deep-simulation §3).
// Чистые правила: голос каждой державы — функция от доказательств, её отношений с целью и
// с инициатором, нрава и того, не она ли спонсирует программу.

import { UN_SUPPORT_FOR, UN_SUPPORT_AGAINST } from '../assets/config';
import { ESCALATION_MAX } from '../assets/config';
import type { FactionId } from './factions';
import type { Temperament } from './diplomacy';

export type ResolutionKind = 'sanctions' | 'inspections';

export const RESOLUTION_NAMES: Record<ResolutionKind, string> = {
  sanctions: 'коалиционные санкции',
  inspections: 'обязательные инспекции',
};

// Постоянные члены совета: их «против» — это вето.
export const PERMANENT_MEMBERS: readonly FactionId[] = ['usa', 'russia', 'china', 'europe'];

export type Vote = 'for' | 'against' | 'abstain';

export interface VoteContext {
  voter: FactionId;
  temperament: Temperament;
  evidence: number; // 0..1 — насколько программа доказана (осведомлённость инициатора)
  hostilityToTarget: number; // 0..1 — накал с целью резолюции
  hostilityToProposer: number; // 0..1 — накал с инициатором
  allyOfTarget: boolean;
  sponsorsTarget: boolean; // держава сама кормит эту программу
  kind: ResolutionKind;
}

export interface VoteResult {
  voter: FactionId;
  vote: Vote;
  support: number;
}

// Поддержка резолюции 0..1. Доказательства — половина веса: без раскрытой программы
// обвинение выглядит как политическая атака, и совет её не поддержит.
export function supportFor(ctx: VoteContext): number {
  let s = ctx.evidence * 0.5;
  s += ctx.hostilityToTarget * 0.3;
  s += (1 - ctx.hostilityToProposer) * 0.2;
  if (ctx.allyOfTarget) s -= 0.3;
  if (ctx.sponsorsTarget) s -= 0.6; // спонсор своих не сдаёт
  if (ctx.temperament === 'dove') s += 0.05; // мирные охотнее давят невоенными мерами
  if (ctx.temperament === 'hawk') s -= 0.05;
  // Инспекции — мягкая мера, её поддержать проще, чем санкции.
  if (ctx.kind === 'inspections') s += 0.1;
  return Math.max(0, Math.min(1, s));
}

export function voteOf(ctx: VoteContext): VoteResult {
  const support = supportFor(ctx);
  const vote: Vote =
    support >= UN_SUPPORT_FOR ? 'for' : support <= UN_SUPPORT_AGAINST ? 'against' : 'abstain';
  return { voter: ctx.voter, vote, support };
}

// Итог голосования: нужно большинство голосовавших «за» среди подавших голос, и ни одного
// «против» от постоянного члена (вето).
export function resolutionOutcome(votes: VoteResult[]): {
  passed: boolean;
  vetoedBy?: FactionId;
  forCount: number;
  againstCount: number;
} {
  const forCount = votes.filter((v) => v.vote === 'for').length;
  const againstCount = votes.filter((v) => v.vote === 'against').length;
  const veto = votes.find(
    (v) => v.vote === 'against' && PERMANENT_MEMBERS.includes(v.voter),
  )?.voter;
  if (veto !== undefined) return { passed: false, vetoedBy: veto, forCount, againstCount };
  return { passed: forCount > votes.length / 2, forCount, againstCount };
}

// Нормализованный накал пары для контекста голосования.
export function hostilityOf(level: number): number {
  return Math.max(0, Math.min(1, level / ESCALATION_MAX));
}
