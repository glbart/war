// Шпионаж (спека 2026-08-29-deep-simulation-design.md §6): осведомлённость игрока о чужих
// программах как ресурс. Знание тает, добывается разведкой и определяет, что вообще видно.

import { INTEL_DECAY, PROGRESS_NOISE_SCALE } from '../assets/config';

// Знание тает: агентура стареет, спутники видят вчерашнее.
export function decayIntel(intel: number, dt: number): number {
  return Math.max(0, intel - INTEL_DECAY * dt);
}

// Что сторона знает на деле: пассивное подозрение (программу выдаёт её же масштаб) —
// нижняя граница; активная разведка добавляет сверху.
export function effectiveKnowledge(suspicion: number, intel: number): number {
  return Math.max(0, Math.min(1, Math.max(suspicion, intel)));
}

// Показанный игроку прогресс: чем хуже разведка, тем сильнее ошибка оценки. Шум
// ДЕТЕРМИНИРОВАННЫЙ (хеш от сида и грубого прогресса) — иначе полоса дрожала бы каждый кадр.
export function noisyProgress(progress: number, knowledge: number, seed: number): number {
  const amp = (1 - Math.max(0, Math.min(1, knowledge))) * PROGRESS_NOISE_SCALE;
  if (amp <= 0) return progress;
  const bucket = Math.round(progress * 20); // грубая сетка: оценка меняется скачками, а не дрожит
  const h = Math.sin(seed * 12.9898 + bucket * 78.233) * 43758.5453;
  const noise = (h - Math.floor(h)) * 2 - 1;
  return Math.max(0, Math.min(1, progress + noise * amp));
}
