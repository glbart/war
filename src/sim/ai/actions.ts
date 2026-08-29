// Шаблоны действий и их соображения (спека 2026-08-29-utility-ai-design.md §3-4).
// Каждое соображение — нормализованное 0..1 значение; НОЛЬ означает вето (произведение
// обнуляется). Поэтому нулём отмечены только настоящие запреты: перемирие, отсутствие целей,
// пустой арсенал, отсутствие обиды (страны сами войну не начинают).

import {
  ESCALATION_MAX,
  AI_PAIN_REF,
  AI_GRIEVANCE_REF,
  AI_STRIKE_COOLDOWN,
} from '../../assets/config';
import {
  SALVO_COUNT,
  RETALIATION_PER_DEATHS,
  RETALIATION_CAP_ESCALATE,
  ALLY_RESPONSE_FRAC,
} from '../../assets/config';
import type { Doctrine, Temperament } from '../diplomacy';
import { evalCurve, sCurve, threshold, RISING, FAST_SATURATE } from './curves';
import type { ActionId, Consideration, DecisionContext, RivalView } from './types';

export interface ActionTemplate {
  id: ActionId;
  needsTarget: boolean;
  // Склонность к действию по нраву — личность страны живёт здесь, а не в ветках кода.
  weight: Record<Temperament, number>;
  considerations: (ctx: DecisionContext, rival?: RivalView) => Consideration[];
}

// ---- Общие входы ----

const pain = (ctx: DecisionContext): number =>
  evalCurve(sCurve(0.5, 8), Math.min(1, ctx.self.damageFrac / AI_PAIN_REF));

const grievance = (rival: RivalView): number =>
  evalCurve(FAST_SATURATE, Math.min(1, rival.grievance / AI_GRIEVANCE_REF));

const capability = (ctx: DecisionContext): number =>
  ctx.self.arsenal <= 0 || ctx.self.citiesAlive <= 0
    ? 0 // нечем или неоткуда пускать — вето
    : evalCurve(FAST_SATURATE, ctx.self.arsenalFrac);

const reach = (rival: RivalView): number => (rival.citiesAlive > 0 ? 1 : 0);
const notTruce = (rival: RivalView): number => (rival.truce ? 0 : 1);
const hostility = (rival: RivalView): number => rival.level / ESCALATION_MAX;
// У ПРО соперника не должно быть права вето: полностью прикрытая цель лишь менее заманчива.
const vulnerability = (rival: RivalView): number => 0.35 + 0.65 * (1 - rival.interceptorsFrac);
const weariness = (ctx: DecisionContext): number =>
  Math.max(0.15, Math.max(pain(ctx), 1 - ctx.self.arsenalFrac));

// Волна только что ушла — следующую готовят не мгновенно. Даёт ритм «залп → пауза → залп»
// вместо капели по ракете на каждый пульс.
const reloaded = (ctx: DecisionContext): number =>
  evalCurve(sCurve(0.5, 9), Math.min(1, ctx.self.sinceStrike / AI_STRIKE_COOLDOWN));

const PEACEFULNESS: Record<Temperament, number> = { dove: 0.85, balanced: 0.55, hawk: 0.3 };
const LOYALTY: Record<Temperament, number> = { dove: 0.5, balanced: 0.65, hawk: 0.8 };

const STRIKE_WEIGHT: Record<Temperament, number> = { dove: 0.75, balanced: 1, hawk: 1.25 };
const PEACE_WEIGHT: Record<Temperament, number> = { dove: 1.45, balanced: 1, hawk: 0.6 };
const WAIT_WEIGHT: Record<Temperament, number> = { dove: 1.1, balanced: 1, hawk: 0.9 };
const ALLY_WEIGHT: Record<Temperament, number> = { dove: 0.9, balanced: 1, hawk: 1.2 };

export const ACTIONS: readonly ActionTemplate[] = [
  {
    id: 'wait',
    needsTarget: false,
    weight: WAIT_WEIGHT,
    considerations: (ctx) => {
      const heat = Math.max(0, ...ctx.rivals.map(hostility));
      return [
        { name: 'осторожность', value: 0.5 },
        { name: 'нет запала', value: Math.max(0.25, 1 - heat) },
      ];
    },
  },
  {
    id: 'demonstrate',
    needsTarget: true,
    weight: STRIKE_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'нет перемирия', value: notTruce(r!) },
      { name: 'есть по чему бить', value: reach(r!) },
      { name: 'есть чем бить', value: capability(ctx) },
      { name: 'обида', value: grievance(r!) },
      // Предупреждение уместно, пока конфликт не разгорелся: на тотальной войне оно смешно.
      { name: 'уместность предупреждения', value: Math.max(0.2, 1 - hostility(r!) * 0.8) },
      { name: 'перезарядка', value: reloaded(ctx) },
    ],
  },
  {
    id: 'limited',
    needsTarget: true,
    weight: STRIKE_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'нет перемирия', value: notTruce(r!) },
      { name: 'есть по чему бить', value: reach(r!) },
      { name: 'есть чем бить', value: capability(ctx) },
      { name: 'обида', value: grievance(r!) },
      { name: 'накал', value: 0.25 + 0.75 * hostility(r!) },
      { name: 'уязвимость цели', value: vulnerability(r!) },
      { name: 'перезарядка', value: reloaded(ctx) },
    ],
  },
  {
    id: 'massive',
    needsTarget: true,
    weight: STRIKE_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'нет перемирия', value: notTruce(r!) },
      { name: 'есть по чему бить', value: reach(r!) },
      { name: 'есть чем бить', value: evalCurve(RISING, ctx.self.arsenalFrac) * capability(ctx) },
      { name: 'обида', value: grievance(r!) },
      { name: 'накал', value: 0.1 + 0.9 * hostility(r!) },
      { name: 'уязвимость цели', value: vulnerability(r!) },
      { name: 'перезарядка', value: reloaded(ctx) },
    ],
  },
  {
    id: 'allOut',
    needsTarget: true,
    weight: STRIKE_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'нет перемирия', value: notTruce(r!) },
      { name: 'есть по чему бить', value: reach(r!) },
      { name: 'есть чем бить', value: capability(ctx) },
      // Всё сразу — только на тотальной войне (ступень 3+) и когда уже очень больно.
      { name: 'война на уничтожение', value: evalCurve(threshold(0.7), hostility(r!)) },
      { name: 'боль', value: Math.max(0.3, pain(ctx)) },
      { name: 'перезарядка', value: reloaded(ctx) },
    ],
  },
  {
    id: 'joinAlly',
    needsTarget: true,
    weight: ALLY_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'нет перемирия', value: notTruce(r!) },
      { name: 'есть по чему бить', value: reach(r!) },
      { name: 'есть чем бить', value: capability(ctx) },
      { name: 'не свой блок', value: r!.ally ? 0 : 1 },
      { name: 'союзника бьют', value: r!.allyHeat / ESCALATION_MAX },
      { name: 'верность', value: LOYALTY[ctx.self.temperament] },
      { name: 'перезарядка', value: reloaded(ctx) },
    ],
  },
  {
    id: 'proposePeace',
    needsTarget: true,
    weight: PEACE_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'идёт война', value: evalCurve(threshold(0.01), hostility(r!)) },
      { name: 'нет перемирия', value: notTruce(r!) },
      // Стол должен быть свободен: если предложение уже лежит (в любую сторону) или мы
      // только что предлагали — новое предложение просто шумит.
      { name: 'стол свободен', value: r!.offerPending || r!.peaceCooldown ? 0 : 1 },
      { name: 'усталость от войны', value: weariness(ctx) },
      { name: 'миролюбие', value: PEACEFULNESS[ctx.self.temperament] },
    ],
  },
  {
    id: 'acceptPeace',
    needsTarget: true,
    weight: PEACE_WEIGHT,
    considerations: (ctx, r) => [
      { name: 'предложение на столе', value: r!.offerFromThem ? 1 : 0 },
      { name: 'усталость от войны', value: weariness(ctx) },
      { name: 'миролюбие', value: PEACEFULNESS[ctx.self.temperament] },
      // Чем горячее конфликт, тем труднее сесть за стол.
      { name: 'накал терпим', value: Math.max(0.2, 1 - 0.6 * hostility(r!)) },
    ],
  },
];

// Доктрина — игровой режим, а не мнение страны: она жёстко отсекает недоступные действия.
export function allowedByDoctrine(doctrine: Doctrine, id: ActionId): boolean {
  if (id === 'wait') return true;
  switch (doctrine) {
    case 'off':
      return false;
    case 'restrained':
      return id !== 'massive' && id !== 'allOut';
    case 'escalate':
      return id !== 'allOut';
    case 'doomsday':
      // Тотальная доктрина не знает переговоров.
      return id !== 'proposePeace' && id !== 'acceptPeace';
  }
}

// Сколько ракет поднимает действие. Соразмерность считается от обиды — той же величины,
// которой соображения меряют желание бить.
export function actionSize(id: ActionId, ctx: DecisionContext, rival: RivalView): number {
  const proportional = Math.max(1, Math.ceil(rival.grievance / RETALIATION_PER_DEATHS));
  let size: number;
  switch (id) {
    case 'demonstrate':
      size = 1;
      break;
    case 'limited':
      size = Math.min(proportional, SALVO_COUNT);
      break;
    case 'massive':
      size = Math.min(proportional * 2, RETALIATION_CAP_ESCALATE);
      break;
    case 'allOut':
      size = Math.min(ctx.self.arsenal, RETALIATION_CAP_ESCALATE);
      break;
    case 'joinAlly':
      size = Math.max(1, Math.ceil(Math.min(proportional, SALVO_COUNT) * ALLY_RESPONSE_FRAC));
      break;
    default:
      return 0; // мирные действия и выжидание ракет не поднимают
  }
  return Math.max(0, Math.min(size, ctx.self.arsenal));
}
