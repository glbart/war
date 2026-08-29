import type { Vec3 } from './geo';
import type { Surface, Biome } from './material';
import type { FactionId } from './factions';
import type { Doctrine } from './diplomacy';
import type { Outcome } from './victory';

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
      reason: 'revenge' | 'ally';
    }
  | { kind: 'doctrineChanged'; doctrine: Doctrine }
  // Работа ПРО: by — кто перехватывал, pos — точка вспышки (в радиусах планеты),
  // success — сбита ли боеголовка (промах тоже тратит перехватчик).
  | { kind: 'interception'; id: number; by: FactionId; pos: Vec3; success: boolean }
  // Переговоры: forPlayer — предложение адресовано стороне игрока и ждёт его ответа.
  | { kind: 'ceasefireProposed'; from: FactionId; to: FactionId; forPlayer: boolean }
  | { kind: 'ceasefireAccepted'; from: FactionId; to: FactionId }
  | { kind: 'ceasefireRejected'; from: FactionId; to: FactionId }
  | { kind: 'truceBroken'; by: FactionId; against: FactionId }
  | { kind: 'gameOver'; outcome: Outcome; winner?: FactionId; summary: SideSummary[] }
  | { kind: 'labelsToggled'; enabled: boolean };
