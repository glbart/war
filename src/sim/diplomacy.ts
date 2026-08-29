// Дипломатия и ответный удар (спека 2026-08-29-retaliation-design.md): чистые данные и
// формулы возмездия — без состояния и без three.js. Изменяемое (запланированные ответы,
// войны) живёт в Simulation.

import {
  SALVO_COUNT,
  RETALIATION_PER_DEATHS,
  RETALIATION_CAP_ESCALATE,
  ALLY_RESPONSE_FRAC,
} from '../assets/config';
import { BELLIGERENTS, type FactionId } from './factions';

// Доктрина ответа — глобальный режим игры (селект в HUD):
//   off        — стороны не отвечают (прежняя песочница);
//   restrained — ответ соразмерен потерям (боеголовка на RETALIATION_PER_DEATHS млн);
//   escalate   — вдвое от соразмерного (обмен раскручивается);
//   doomsday   — весь арсенал одной волной (мир кончается за пару обменов).
export type Doctrine = 'off' | 'restrained' | 'escalate' | 'doomsday';

export const DOCTRINES: readonly Doctrine[] = ['off', 'restrained', 'escalate', 'doomsday'];

// По умолчанию стороны отвечают соразмерно: мир живой, но не заканчивается с первого клика.
export const DEFAULT_DOCTRINE: Doctrine = 'restrained';

export const DOCTRINE_NAMES: Record<Doctrine, string> = {
  off: 'выкл',
  restrained: 'сдержанный',
  escalate: 'эскалация',
  doomsday: 'всё сразу',
};

export function isDoctrine(v: unknown): v is Doctrine {
  return typeof v === 'string' && (DOCTRINES as readonly string[]).includes(v);
}

// Игровые блоки союзников. Это баланс, а не утверждение о реальных союзах: удар по стороне
// втягивает её блок, и обмен расходится по миру, а не остаётся дуэлью. Индия и Пакистан
// намеренно без союзников — их обмен остаётся локальным.
const BLOCS: readonly (readonly FactionId[])[] = [
  ['usa', 'europe', 'israel'],
  ['russia', 'china', 'dprk'],
];

const ALLIES = new Map<FactionId, readonly FactionId[]>();
for (const f of BELLIGERENTS) {
  const bloc = BLOCS.find((b) => b.includes(f.id));
  ALLIES.set(f.id, bloc ? bloc.filter((id) => id !== f.id) : []);
}

// Союзники стороны (без неё самой). Нейтральные ни с кем не связаны.
export function alliesOf(id: FactionId): readonly FactionId[] {
  return ALLIES.get(id) ?? [];
}

// Сколько ракет поднимает сторона в ответ: соразмерно погибшим (grievance, млн), с поправкой
// на доктрину, вполовину — если вступается за союзника, и не больше остатка арсенала.
// Ноль означает «ответа не будет» (доктрина off или пустой арсенал).
export function responseSize(
  grievance: number,
  arsenal: number,
  doctrine: Doctrine,
  ally: boolean,
): number {
  if (doctrine === 'off' || arsenal <= 0) return 0;

  let size: number;
  if (doctrine === 'doomsday') {
    size = Math.min(arsenal, RETALIATION_CAP_ESCALATE);
  } else {
    const base = Math.max(1, Math.ceil(grievance / RETALIATION_PER_DEATHS));
    size =
      doctrine === 'escalate'
        ? Math.min(base * 2, RETALIATION_CAP_ESCALATE)
        : Math.min(base, SALVO_COUNT);
  }
  // За союзника вступаются меньшими силами — но хотя бы одной ракетой.
  if (ally) size = Math.max(1, Math.ceil(size * ALLY_RESPONSE_FRAC));
  return Math.min(size, arsenal);
}
