import type { Vec3 } from './geo';
import type { Surface, Biome } from './material';

// События, которые симуляция эмитит наружу (для рендера/UI/сети).
export type SimEvent =
  | { kind: 'missileLaunched'; id: number; dir: Vec3; yield: number }
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
