// Контракты слоя принятия решений (спека 2026-08-29-utility-ai-design.md).
// ВАЖНО: решение принимается по КОНТЕКСТУ — снимку того, что сторона знает о мире, а не по
// самой Simulation. Это и делает решение чистой функцией (тестируется таблицей), и оставляет
// место для будущей разведки: достаточно будет зашумить контекст, интерфейс не изменится.

import type { FactionId } from '../factions';
import type { Doctrine, Temperament } from '../diplomacy';

export type ActionId =
  | 'wait' // копить силы, не отсвечивать
  | 'demonstrate' // предупредительный удар одной ракетой
  | 'limited' // соразмерный ответ
  | 'massive' // полномасштабный удар
  | 'allOut' // всё, что есть
  | 'joinAlly' // вступиться за союзника
  | 'proposePeace' // предложить перемирие
  | 'acceptPeace'; // принять лежащее предложение

export const ACTION_NAMES: Record<ActionId, string> = {
  wait: 'выжидает',
  demonstrate: 'предупредительный удар',
  limited: 'ограниченный удар',
  massive: 'полномасштабный удар',
  allOut: 'удар всем арсеналом',
  joinAlly: 'вступается за союзника',
  proposePeace: 'предлагает перемирие',
  acceptPeace: 'принимает перемирие',
};

// Что сторона знает о сопернике. Пока это точные данные симуляции; с приходом разведки здесь
// появятся оценки с шумом и запаздыванием — потребители не изменятся.
export interface RivalView {
  id: FactionId;
  level: number; // ступень эскалации пары
  truce: boolean; // действует перемирие
  arsenal: number;
  interceptorsFrac: number; // остаток ПРО соперника, доля от исходного
  popAliveFrac: number;
  citiesAlive: number;
  grievance: number; // накопленная обида именно к нему, млн погибших
  offerFromThem: boolean; // на столе лежит его предложение перемирия
  offerPending: boolean; // по этой паре уже идут переговоры (предложение любой стороны)
  peaceCooldown: boolean; // недавно уже предлагали — новая попытка пока бессмысленна
  ally: boolean; // это мой союзник по блоку
  allyHeat: number; // максимальная ступень пары «мой союзник ↔ он» (для joinAlly)
}

export interface SelfView {
  id: FactionId;
  temperament: Temperament;
  arsenal: number;
  arsenalFrac: number;
  interceptorsFrac: number;
  damageFrac: number; // доля потерянного населения
  citiesAlive: number;
  sinceStrike: number; // сек с собственного последнего залпа (перезарядка решимости)
}

export interface DecisionContext {
  self: SelfView;
  rivals: RivalView[];
  doctrine: Doctrine;
  ceiling: number; // потолок лестницы эскалации при текущей доктрине
}

// Разложение оценки — то, что показывает панель «почему».
export interface Consideration {
  name: string;
  value: number;
}

export interface Candidate {
  action: ActionId;
  target?: FactionId;
  score: number;
  considerations: Consideration[];
}

export interface Decision {
  action: ActionId;
  target?: FactionId;
  score: number;
  top: Candidate[]; // лучшие варианты с разложением (для объяснимости)
}
