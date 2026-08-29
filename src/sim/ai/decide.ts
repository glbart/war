// Ядро принятия решений (спека 2026-08-29-utility-ai-design.md §2): перебрать варианты,
// оценить каждый произведением соображений, выбрать. ЧИСТАЯ функция от контекста и Rng —
// никакого доступа к Simulation, поэтому решение проверяется таблицей в юнит-тесте, а панель
// «почему» получает то же разложение, что видел алгоритм.

import { Rng } from '../../core/time';
import {
  AI_ACTION_THRESHOLD,
  AI_TOP_BAND,
  AI_INERTIA_BONUS,
  AI_TOP_KEEP,
} from '../../assets/config';
import { combineScore } from './curves';
import { ACTIONS, allowedByDoctrine } from './actions';
import type { Candidate, Decision, DecisionContext } from './types';

// Прошлый выбор стороны — ему даётся инерция, чтобы страна не металась каждый пульс.
export interface LastChoice {
  action: Candidate['action'];
  target?: Candidate['target'];
}

function evaluate(ctx: DecisionContext, last?: LastChoice): Candidate[] {
  const out: Candidate[] = [];
  for (const template of ACTIONS) {
    if (!allowedByDoctrine(ctx.doctrine, template.id)) continue;
    const targets = template.needsTarget ? ctx.rivals : [undefined];
    for (const rival of targets) {
      const considerations = template.considerations(ctx, rival);
      const base = combineScore(considerations.map((c) => c.value));
      if (base <= 0) continue; // сработало вето — вариант даже не показываем
      const weighted = Math.min(1, base * template.weight[ctx.self.temperament]);
      const inertia =
        last && last.action === template.id && last.target === rival?.id ? AI_INERTIA_BONUS : 1;
      out.push({
        action: template.id,
        target: rival?.id,
        score: Math.min(1, weighted * inertia),
        considerations,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// Решение стороны. Среди вариантов не хуже AI_TOP_BAND от лучшего бросается взвешенный
// жребий — одинаковый вход не даёт механически одинакового поведения, но всё остаётся
// детерминированным от seed.
export function decide(ctx: DecisionContext, rng: Rng, last?: LastChoice): Decision {
  const candidates = evaluate(ctx, last);
  const best = candidates[0];

  // ВЫБРАННЫЙ вариант всегда идёт первым в top: панель «почему» должна объяснять именно то
  // решение, которое принято, а не просто лучшее по оценке (жребий мог выбрать другое).
  const explain = (chosen: Candidate | undefined): Candidate[] =>
    chosen === undefined
      ? candidates.slice(0, AI_TOP_KEEP)
      : [chosen, ...candidates.filter((c) => c !== chosen)].slice(0, AI_TOP_KEEP);

  if (best === undefined || best.score < AI_ACTION_THRESHOLD) {
    // Ничего не дотянуло до порога — сторона выжидает, и в отчёт идёт оценка самого выжидания.
    const waiting = candidates.find((c) => c.action === 'wait');
    return { action: 'wait', score: waiting?.score ?? 0, top: explain(waiting) };
  }

  const band = candidates.filter((c) => c.score >= best.score * AI_TOP_BAND);
  const total = band.reduce((sum, c) => sum + c.score, 0);
  let roll = rng.range(0, total);
  let chosen = band[band.length - 1]!;
  for (const c of band) {
    roll -= c.score;
    if (roll <= 0) {
      chosen = c;
      break;
    }
  }
  return {
    action: chosen.action,
    target: chosen.target,
    score: chosen.score,
    top: explain(chosen),
  };
}
