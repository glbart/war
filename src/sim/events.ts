import type { Vec3 } from './geo';
import type { Surface, Biome } from './material';
import type { FactionId } from './factions';
import type { Doctrine } from './diplomacy';
import type { Outcome } from './victory';
import type { ActionId, Candidate } from './ai/types';
import type { ProgramStage } from './proliferation';

// Что игрок знает о чужой программе: пока подозрение ниже порога, стадия и прогресс скрыты.
export type ProgramView = {
  id: FactionId;
  revealed: boolean;
  stage: ProgramStage;
  progress: number; // весь путь к бомбе 0..1
  motivation: number;
  suspicion: number;
  sanctions: boolean;
  treaty: boolean;
};

// Сводка кампании для экрана итогов.
export type CampaignSummary = {
  elapsed: number;
  armed: FactionId[]; // кто успел получить бомбу
  stopped: number; // программ не доведено до бомбы
  treaties: number;
  sanctions: number;
  sabotages: number;
  strikes: number; // ударов по программам
  influence: number;
};

// Изменяемое состояние стороны для HUD (статику — название/цвет/исходное население — HUD
// берёт из sim/factions.ts напрямую, чтобы не гонять её в каждом событии).
export type FactionStat = {
  id: FactionId;
  popAlive: number; // живое население городов стороны, млн
  citiesAlive: number; // сколько городов ещё не опустошено
  arsenal: number; // осталось боеголовок
  interceptors: number; // осталось перехватчиков ПРО
  // С кем сторона в конфликте: уровень эскалации 1..4 и признак действующего перемирия.
  enemies: { id: FactionId; level: number; truce: boolean }[];
};

// Строка экрана итогов по стороне (событие gameOver).
export type SideSummary = {
  id: FactionId;
  popAlive: number;
  popTotal: number;
  killed: number; // сколько населения выбили её удары
  launched: number; // пущено боеголовок
  intercepted: number; // сбито чужих боеголовок её ПРО
  arsenal: number;
  interceptors: number;
};

// События, которые симуляция эмитит наружу (для рендера/UI/сети).
export type SimEvent =
  // from — точка старта баллистической МБР (нет — удар из космоса); flightTime — сек до
  // детонации; faction — чья ракета (рендер красит след цветом стороны).
  | {
      kind: 'missileLaunched';
      id: number;
      dir: Vec3;
      yield: number;
      flightTime: number;
      from?: Vec3;
      faction?: FactionId;
    }
  | {
      kind: 'explosionStarted';
      id: number;
      dir: Vec3;
      yield: number;
      seed: number;
      surface: Surface;
      biome: Biome;
    }
  | {
      kind: 'cityHit';
      name: string;
      deaths: number;
      atWaveTime: number;
      faction: FactionId;
      alive: number;
    }
  | { kind: 'planetReset' }
  | { kind: 'statsChanged'; bombs: number; megatons: number; deaths: number }
  | { kind: 'factionsChanged'; factions: FactionStat[] }
  // Сторона подняла ответный залп: reason 'revenge' — за себя, 'ally' — вступилась за союзника.
  | {
      kind: 'retaliationLaunched';
      from: FactionId;
      to: FactionId;
      count: number;
      action: ActionId; // каким именно решением поднята волна
    }
  | { kind: 'doctrineChanged'; doctrine: Doctrine }
  // Решение стороны на её пульсе: выбранное действие и разложение лучших вариантов —
  // это же и питает панель «почему» в HUD (спека 2026-08-29-utility-ai §7).
  | {
      kind: 'decisionMade';
      faction: FactionId;
      action: ActionId;
      target?: FactionId;
      score: number;
      top: Candidate[];
    }
  // Работа ПРО: by — кто перехватывал, pos — точка вспышки (в радиусах планеты),
  // success — сбита ли боеголовка (промах тоже тратит перехватчик).
  | { kind: 'interception'; id: number; by: FactionId; pos: Vec3; success: boolean }
  // Переговоры: forPlayer — предложение адресовано стороне игрока и ждёт его ответа.
  | { kind: 'ceasefireProposed'; from: FactionId; to: FactionId; forPlayer: boolean }
  | { kind: 'ceasefireAccepted'; from: FactionId; to: FactionId }
  | { kind: 'ceasefireRejected'; from: FactionId; to: FactionId }
  | { kind: 'truceBroken'; by: FactionId; against: FactionId }
  | {
      kind: 'gameOver';
      outcome: Outcome;
      winner?: FactionId;
      summary: SideSummary[];
      campaign: CampaignSummary;
    }
  // Раз в секунду: состояние кампании и всех программ (то, что известно игроку).
  | { kind: 'campaignChanged'; influence: number; elapsed: number; programs: ProgramView[] }
  | { kind: 'programRevealed'; faction: FactionId; stage: ProgramStage }
  | { kind: 'nuclearTest'; faction: FactionId } // страна провела испытание и стала державой
  | { kind: 'treatyAnswer'; faction: FactionId; accepted: boolean }
  | { kind: 'sanctionsImposed'; faction: FactionId }
  | { kind: 'inspected'; faction: FactionId; stage: ProgramStage }
  | { kind: 'sabotageResult'; faction: FactionId; success: boolean }
  | { kind: 'labelsToggled'; enabled: boolean };
