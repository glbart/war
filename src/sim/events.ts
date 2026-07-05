import type { Vec3 } from './geo';

// События, которые симуляция эмитит наружу (для рендера/UI/сети).
export type SimEvent =
  | { kind: 'missileLaunched'; id: number; dir: Vec3; yield: number }
  | { kind: 'explosionStarted'; id: number; dir: Vec3; yield: number; seed: number }
  | { kind: 'cityHit'; name: string; deaths: number; atWaveTime: number }
  | { kind: 'planetReset' }
  | { kind: 'statsChanged'; bombs: number; megatons: number; deaths: number }
  | { kind: 'labelsToggled'; enabled: boolean };
