// Условия победы (спека 2026-08-29-abm-escalation-victory-design.md §4): чистая функция от
// снимка сторон и состояния партии. Ничего не знает о симуляции — её легко проверить тестом
// и переиспользовать на стороне сети/реплея.

import { FALLEN_FRAC } from '../assets/config';
import type { FactionId } from './factions';

export type Outcome = 'victory' | 'mutual' | 'exhausted' | 'peace' | 'pyrrhic';

export const OUTCOME_TITLES: Record<Outcome, string> = {
  victory: 'Победа',
  mutual: 'Взаимное уничтожение',
  exhausted: 'Арсеналы исчерпаны',
  peace: 'Мир восстановлен',
  pyrrhic: 'Разорённый мир',
};

// Снимок одной воюющей стороны для оценки исхода (нейтральные в оценке не участвуют).
export interface SideSnapshot {
  id: FactionId;
  popAlive: number;
  popTotal: number;
  arsenal: number;
  citiesAlive: number;
}

export interface GameState {
  warHappened: boolean; // была ли вообще война (без неё исхода нет)
  missilesInFlight: number;
  atPeace: boolean; // все пары на нулевом уровне или в перемирии
  quietFor: number; // сек с последнего взрыва
  peaceHoldT: number; // сколько тишины нужно для исхода «мир восстановлен»
}

export function isFallen(s: SideSnapshot): boolean {
  return s.popTotal > 0 && s.popAlive < s.popTotal * FALLEN_FRAC;
}

// Может ли сторона вообще воевать дальше: нужны и боеголовки, и живые города (пусковые).
export function canFight(s: SideSnapshot): boolean {
  return s.arsenal > 0 && s.citiesAlive > 0;
}

// Исход партии или undefined, если она продолжается. Порядок проверок важен: полное
// уничтожение и единственный выживший сильнее «исчерпания» и «мира».
export function evaluateOutcome(
  sides: SideSnapshot[],
  state: GameState,
): { outcome: Outcome; winner?: FactionId } | undefined {
  if (!state.warHappened) return undefined;

  const standing = sides.filter((s) => !isFallen(s));
  if (standing.length === 0) return { outcome: 'mutual' };
  if (standing.length === 1) return { outcome: 'victory', winner: standing[0]!.id };

  if (state.missilesInFlight > 0) return undefined;
  if (!sides.some(canFight)) return { outcome: 'exhausted' };
  if (state.atPeace && state.quietFor >= state.peaceHoldT) {
    // «Мир восстановлен» — только если войну пережили все. Если кто-то стёрт, а уцелевшие
    // разошлись, это не мир, а разорённый мир: называть вещи своими именами.
    return standing.length === sides.length ? { outcome: 'peace' } : { outcome: 'pyrrhic' };
  }
  return undefined;
}
