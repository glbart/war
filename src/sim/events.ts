import type { Vec3 } from './geo';
import type { Surface, Biome } from './material';
import type { FactionId } from './factions';

// Изменяемое состояние стороны для HUD (статику — название/цвет/исходное население — HUD
// берёт из sim/factions.ts напрямую, чтобы не гонять её в каждом событии).
export type FactionStat = {
  id: FactionId;
  popAlive: number; // живое население городов стороны, млн
  citiesAlive: number; // сколько городов ещё не опустошено
  arsenal: number; // осталось боеголовок
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
  | { kind: 'labelsToggled'; enabled: boolean };
