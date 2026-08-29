// Дипломатия: лестница эскалации, нравы сторон, размер ответа и склонность к переговорам
// (спеки 2026-08-29-retaliation-design.md и 2026-08-29-abm-escalation-victory-design.md).
// Чистые данные и формулы — состояние (уровни пар, перемирия) живёт в Simulation.

import {
  SALVO_COUNT,
  RETALIATION_PER_DEATHS,
  RETALIATION_CAP_ESCALATE,
  ALLY_RESPONSE_FRAC,
  ESCALATION_MAX,
} from '../assets/config';
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
  neutral: 'dove',
};

const TEMPERAMENT_PEACE: Record<Temperament, number> = { dove: 0.45, balanced: 0.3, hawk: 0.15 };

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

// Размер ответной волны по уровню эскалации пары (спека §3):
//   1 — демонстрация (одна ракета), 2 — соразмерно потерям, 3 — вдвое, 4 — весь арсенал.
// Союзник вступается вполовину меньшими силами, но не меньше одной ракеты.
export function responseSizeForLevel(
  level: number,
  grievance: number,
  arsenal: number,
  ally: boolean,
): number {
  if (level <= 0 || arsenal <= 0) return 0;

  const proportional = Math.max(1, Math.ceil(grievance / RETALIATION_PER_DEATHS));
  let size: number;
  if (level === 1) size = 1;
  else if (level === 2) size = Math.min(proportional, SALVO_COUNT);
  else if (level === 3) size = Math.min(proportional * 2, RETALIATION_CAP_ESCALATE);
  else size = Math.min(arsenal, RETALIATION_CAP_ESCALATE);

  if (ally) size = Math.max(1, Math.ceil(size * ALLY_RESPONSE_FRAC));
  return Math.min(size, arsenal);
}

// Готовность стороны пойти на перемирие (0..1): растёт от полученного урона и опустевающего
// арсенала, падает с накалом; нрав и доктрина сдвигают базу. При doomsday/off переговоров нет.
export function peaceWillingness(opts: {
  temperament: Temperament;
  doctrine: Doctrine;
  level: number;
  damageFrac: number; // доля потерянного населения 0..1
  arsenalFrac: number; // остаток арсенала 0..1
}): number {
  const { temperament, doctrine, level, damageFrac, arsenalFrac } = opts;
  if (doctrine === 'doomsday' || doctrine === 'off') return 0;

  let p = TEMPERAMENT_PEACE[temperament];
  p += clamp01(damageFrac) * 0.5;
  p += (1 - clamp01(arsenalFrac)) * 0.3;
  p -= Math.max(0, level - 1) * 0.08;
  p += doctrine === 'restrained' ? 0.15 : -0.05;
  return Math.max(0, Math.min(0.95, p));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
