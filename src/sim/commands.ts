import type { Vec3 } from './geo';
import type { FactionId } from './factions';
import type { Doctrine } from './diplomacy';

// Команды, которыми внешний слой (ввод/сеть) управляет симуляцией.
export type Command =
  // faction — чей это удар (сторона игрока, выбранная в HUD): по нему жертва решает, кому
  // мстить. Не задан → удар анонимный, жертва винит случайную сторону (спека 2026-08-29).
  | { kind: 'detonate'; dir: Vec3; yield: number; faction?: FactionId }
  // Залп МБР (спека 2026-08-29): from — сторона-агрессор, to — сторона-цель; поля
  // необязательны, не заданы → симуляция выбирает стороны сама (Rng). Старты — у живых
  // городов агрессора, цели — живые города стороны to; расход — по боеголовке на ракету.
  | { kind: 'salvo'; from?: FactionId; to?: FactionId }
  | { kind: 'setYield'; yield: number }
  | { kind: 'setDoctrine'; doctrine: Doctrine } // режим ответных ударов сторон
  | { kind: 'reset' }
  | { kind: 'toggleLabels' };
