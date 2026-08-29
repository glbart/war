import type { Vec3 } from './geo';
import type { FactionId } from './factions';

// Команды, которыми внешний слой (ввод/сеть) управляет симуляцией.
export type Command =
  | { kind: 'detonate'; dir: Vec3; yield: number }
  // Залп МБР (спека 2026-08-29): from — сторона-агрессор, to — сторона-цель; поля
  // необязательны, не заданы → симуляция выбирает стороны сама (Rng). Старты — у живых
  // городов агрессора, цели — живые города стороны to; расход — по боеголовке на ракету.
  | { kind: 'salvo'; from?: FactionId; to?: FactionId }
  | { kind: 'setYield'; yield: number }
  | { kind: 'reset' }
  | { kind: 'toggleLabels' };
