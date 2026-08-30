// Ядерные программы стран-претендентов (спека 2026-08-29-nonproliferation-design.md §3):
// чистые данные и формулы. Состояние программ живёт в Simulation, здесь — только правила.

import {
  PROGRAM_BASE_RATE,
  PROGRAM_STAGES,
  PROGRAM_START_MOTIVATION,
  SANCTION_SLOWDOWN,
  SUSPICION_REVEAL,
} from '../assets/config';
import { evalCurve, sCurve, FAST_SATURATE } from './ai/curves';
import type { FactionId } from './factions';

// Стадии программы. armed — испытание проведено, страна стала ядерной державой.
export type ProgramStage = 'none' | 'research' | 'enrichment' | 'weapon' | 'armed';

export const STAGE_ORDER: readonly ProgramStage[] = [
  'none',
  'research',
  'enrichment',
  'weapon',
  'armed',
];

export const STAGE_NAMES: Record<ProgramStage, string> = {
  none: 'программы нет',
  research: 'исследования',
  enrichment: 'обогащение',
  weapon: 'сборка заряда',
  armed: 'испытание проведено',
};

// Характер страны-претендента: насколько она изначально хочет бомбу и что может.
export interface AspirantProfile {
  motivation: number; // базовая мотивация 0..1, к ней тянется текущая
  capacity: number; // научно-промышленный потенциал 0..1 — множитель скорости
}

export const ASPIRANT_PROFILES: Record<string, AspirantProfile> = {
  iran: { motivation: 0.7, capacity: 0.55 },
  saudi: { motivation: 0.5, capacity: 0.4 },
  turkey: { motivation: 0.4, capacity: 0.5 },
  egypt: { motivation: 0.3, capacity: 0.35 },
  japan: { motivation: 0.2, capacity: 0.95 }, // может быстро, но не хочет
  korea: { motivation: 0.45, capacity: 0.85 },
  brazil: { motivation: 0.15, capacity: 0.6 },
  safrica: { motivation: 0.15, capacity: 0.5 },
};

// Изменяемое состояние программы (живёт в Simulation, здесь — форма и правила над ней).
export interface Program {
  id: FactionId;
  stage: ProgramStage;
  progress: number; // 0..1 внутри текущей стадии
  motivation: number;
  capacity: number;
  suspicion: number; // 0..1 — насколько мир осведомлён
  sanctions: number; // сек до конца санкций
  treaty: number; // сек до конца договора (программа заморожена)
}

export function createProgram(id: FactionId, profile: AspirantProfile): Program {
  return {
    id,
    stage: 'none',
    progress: 0,
    motivation: profile.motivation,
    capacity: profile.capacity,
    suspicion: 0,
    sanctions: 0,
    treaty: 0,
  };
}

// Скорость прогресса (доля стадии в секунду). Договор останавливает работы полностью,
// санкции режут темп, мотивация и потенциал — множители.
export function programRate(p: Program): number {
  if (p.treaty > 0 || p.stage === 'armed') return 0;
  if (p.stage === 'none' && p.motivation < PROGRAM_START_MOTIVATION) return 0;
  const sanctionFactor = p.sanctions > 0 ? SANCTION_SLOWDOWN : 1;
  return PROGRAM_BASE_RATE * p.motivation * p.capacity * sanctionFactor;
}

// Полный путь к бомбе в долях (для полос прогресса и подозрения): none=0 … armed=1.
export function totalProgress(p: Program): number {
  const done = Math.max(0, STAGE_ORDER.indexOf(p.stage) - 1);
  if (p.stage === 'armed') return 1;
  return Math.min(1, (done + p.progress) / PROGRAM_STAGES);
}

// Продвигает программу на dt секунд: прогресс, переход стадий, рост подозрения.
// rateMultiplier — внешние множители темпа: спонсорские деньги ускоряют, нехватка бюджета
// тормозит (спека 2026-08-29-deep-simulation §2, §5).
// Возвращает true, если страна ПРОВЕЛА ИСПЫТАНИЕ на этом шаге (стала ядерной державой).
export function advanceProgram(p: Program, dt: number, rateMultiplier = 1): boolean {
  p.sanctions = Math.max(0, p.sanctions - dt);
  p.treaty = Math.max(0, p.treaty - dt);
  if (p.stage === 'armed') return false;

  const rate = programRate(p) * Math.max(0, rateMultiplier);
  if (rate > 0 && p.stage === 'none') p.stage = 'research';
  p.progress += rate * dt;
  while (p.progress >= 1 && p.stage !== 'armed') {
    p.progress -= 1;
    const next: ProgramStage | undefined = STAGE_ORDER[STAGE_ORDER.indexOf(p.stage) + 1];
    p.stage = next ?? 'armed';
  }
  if (p.stage === 'armed') {
    p.progress = 0;
    p.suspicion = 1;
    return true;
  }
  // Чем дальше зашла программа, тем труднее её прятать.
  p.suspicion = Math.max(p.suspicion, evalCurve(FAST_SATURATE, totalProgress(p)) * 0.8);
  return false;
}

// Подтверждена ли программа для игрока (иначе HUD показывает «не подтверждена»).
export function isRevealed(p: Program): boolean {
  return p.suspicion >= SUSPICION_REVEAL;
}

// Дрейф мотивации: тянется к базовой, растёт от угрозы (война/удары по себе), падает под
// действующим договором. Всё в 0..1.
export function motivationDrift(
  p: Program,
  base: number,
  threat: number, // 0..1 — накал вокруг страны
  dt: number,
): number {
  const target = p.treaty > 0 ? base * 0.35 : Math.min(1, base + threat * 0.6);
  const speed = p.treaty > 0 ? 0.05 : 0.03;
  const next = p.motivation + (target - p.motivation) * Math.min(1, speed * dt);
  return Math.max(0, Math.min(1, next));
}

// Согласие на договор: чем ниже мотивация, чем раньше стадия и чем сильнее давление санкций,
// тем охотнее страна замораживает программу. Возвращает вероятность 0..1.
export function treatyAcceptance(p: Program): number {
  const calm = evalCurve(sCurve(0.5, 7), 1 - p.motivation);
  const early = 1 - totalProgress(p) * 0.8;
  const pressure = p.sanctions > 0 ? 1.25 : 1;
  return Math.max(0, Math.min(0.95, calm * early * pressure));
}

// Откат программы: удар по стране отбрасывает её на стадию назад, саботаж — на долю прогресса.
export function setbackByStrike(p: Program): void {
  if (p.stage === 'armed' || p.stage === 'none') return;
  const idx = STAGE_ORDER.indexOf(p.stage);
  p.stage = STAGE_ORDER[Math.max(1, idx - 1)] ?? 'research';
  p.progress = 0;
}

export function setbackByFraction(p: Program, fraction: number): void {
  if (p.stage === 'armed' || p.stage === 'none') return;
  p.progress -= fraction;
  while (p.progress < 0) {
    const idx = STAGE_ORDER.indexOf(p.stage);
    if (idx <= 1) {
      p.progress = 0;
      break;
    }
    p.stage = STAGE_ORDER[idx - 1]!;
    p.progress += 1;
  }
}
