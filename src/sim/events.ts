import type { Vec3 } from './geo';
import type { Surface, Biome } from './material';

// События, которые симуляция эмитит наружу (для рендера/UI/сети).
export type SimEvent =
  // from — точка старта баллистической МБР (нет — удар из космоса); flightTime — сек до детонации
  | { kind: 'missileLaunched'; id: number; dir: Vec3; yield: number; flightTime: number; from?: Vec3 }
  | {
      kind: 'explosionStarted';
      id: number;
      dir: Vec3;
      yield: number;
      seed: number;
      surface: Surface;
      biome: Biome;
    }
  | { kind: 'cityHit'; name: string; deaths: number; atWaveTime: number }
  | { kind: 'planetReset' }
  | { kind: 'statsChanged'; bombs: number; megatons: number; deaths: number }
  | { kind: 'labelsToggled'; enabled: boolean };
