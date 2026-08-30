import type { Vec3 } from './geo';
import type { FactionId } from './factions';
import type { Doctrine } from './diplomacy';
import type { ResolutionKind } from './un';
import type { ScenarioId } from './scenarios';

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
  // Сторона игрока: ей приписываются ручные удары, ей же адресуют предложения перемирия
  // (иначе решение за неё принимает ИИ). undefined — игрок «наблюдатель».
  | { kind: 'setSide'; faction?: FactionId }
  | { kind: 'proposeCeasefire'; from: FactionId; to: FactionId }
  | { kind: 'ceasefireResponse'; from: FactionId; to: FactionId; accept: boolean }
  // Инструменты нераспространения (спека 2026-08-29-nonproliferation §4): каждый стоит
  // влияния; цель — страна-претендент.
  | { kind: 'offerTreaty'; target: FactionId }
  | { kind: 'imposeSanctions'; target: FactionId }
  | { kind: 'inspect'; target: FactionId }
  | { kind: 'sabotage'; target: FactionId }
  // Глубокая симуляция (спека 2026-08-29-deep-simulation): зонтик, разведка, резолюции ООН,
  // выбор сценария кампании.
  | { kind: 'offerGuarantee'; target: FactionId }
  | { kind: 'revokeGuarantee'; target: FactionId }
  | { kind: 'recon'; target: FactionId }
  | { kind: 'proposeResolution'; target: FactionId; resolution: ResolutionKind }
  | { kind: 'setScenario'; scenario: ScenarioId }
  | { kind: 'reset' }
  | { kind: 'toggleLabels' };
