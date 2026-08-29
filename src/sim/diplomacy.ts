// Дипломатия: лестница эскалации, нравы сторон, размер ответа и склонность к переговорам
// (спеки 2026-08-29-retaliation-design.md и 2026-08-29-abm-escalation-victory-design.md).
// Чистые данные и формулы — состояние (уровни пар, перемирия) живёт в Simulation.

import { ESCALATION_MAX } from '../assets/config';
import { BELLIGERENTS, type FactionId } from './factions';

// Доктрина — глобальный режим игры: потолок лестницы эскалации и общая склонность
// договариваться. off — стороны вообще не отвечают (песочница как до фичи).
export type Doctrine = 'off' | 'restrained' | 'escalate' | 'doomsday';

export const DOCTRINES: readonly Doctrine[] = ['off', 'restrained', 'escalate', 'doomsday'];

export const DOCTRINE_NAMES: Record<Doctrine, string> = {
  off: 'выкл',
  restrained: 'сдержанный',
  escalate: 'эскалация',
  doomsday: 'всё сразу',
};

// По умолчанию стороны отвечают сдержанно и охотно ищут мира.
export const DEFAULT_DOCTRINE: Doctrine = 'restrained';

export function isDoctrine(v: unknown): v is Doctrine {
  return typeof v === 'string' && (DOCTRINES as readonly string[]).includes(v);
}

// Потолок лестницы эскалации для доктрины: до какого уровня стороны готовы дойти.
export function doctrineCeiling(d: Doctrine): number {
  switch (d) {
    case 'off':
      return 0;
    case 'restrained':
      return 2;
    case 'escalate':
      return 3;
    case 'doomsday':
      return ESCALATION_MAX;
  }
}

// Уровни отношений пары сторон — для HUD и ленты.
export const ESCALATION_NAMES: readonly string[] = [
  'мир',
  'кризис',
  'ограниченная война',
  'полномасштабная война',
  'тотальная война',
];

export function escalationName(level: number): string {
  return ESCALATION_NAMES[Math.max(0, Math.min(ESCALATION_MAX, level))]!;
}

// Нрав стороны: насколько охотно она садится за стол переговоров и как быстро зверствует.
export type Temperament = 'dove' | 'balanced' | 'hawk';

export const TEMPERAMENTS: Record<FactionId, Temperament> = {
  usa: 'balanced',
  russia: 'hawk',
  china: 'balanced',
  europe: 'dove',
  india: 'balanced',
  pakistan: 'hawk',
  dprk: 'hawk',
  israel: 'hawk',
  iran: 'hawk',
  saudi: 'balanced',
  turkey: 'balanced',
  egypt: 'balanced',
  japan: 'dove',
  korea: 'balanced',
  brazil: 'dove',
  safrica: 'dove',
  neutral: 'dove',
};

// Игровые блоки союзников (баланс, не утверждение о реальных союзах): удар по стороне
// втягивает её блок. Индия и Пакистан намеренно без союзников — их обмен локален.
const BLOCS: readonly (readonly FactionId[])[] = [
  ['usa', 'europe', 'israel'],
  ['russia', 'china', 'dprk'],
];

const ALLIES = new Map<FactionId, readonly FactionId[]>();
for (const f of BELLIGERENTS) {
  const bloc = BLOCS.find((b) => b.includes(f.id));
  ALLIES.set(f.id, bloc ? bloc.filter((id) => id !== f.id) : []);
}

export function alliesOf(id: FactionId): readonly FactionId[] {
  return ALLIES.get(id) ?? [];
}
