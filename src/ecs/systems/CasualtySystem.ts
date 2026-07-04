import { angleBetween, type Vec3 } from '../../sim/geo';
import type { City } from '../../sim/cities';
import { YIELDS, type Yield } from '../../assets/config';

// Мощности заряда, поддерживаемые демо (мегатонны).
type YieldMt = Yield;

// Таблицы параметров волны по мощности заряда (порт из демо, ~723-730).
// ts (временной масштаб волны) в эту функцию передаётся вызывающей стороной —
// таблица TS в демо используется для его расчёта на стороне Simulation.
const ANG_PATCH: Record<YieldMt, number> = { 1: 0.05, 10: 0.082, 100: 0.14 };
const YS: Record<YieldMt, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };

export type CasualtyHit = { name: string; deaths: number; atWaveTime: number };

// Чистая функция расчёта жертв взрыва (порт формулы из демо, ~795-809).
// Мутирует cities на месте: c.alive уменьшается на число погибших, поэтому
// повторный удар по уже опустошённому городу почти ничего не убьёт.
export function computeCasualties(
  cities: City[],
  dir: Vec3,
  yieldMt: number,
  ts: number,
): { hits: CasualtyHit[]; totalDeaths: number } {
  // Runtime-guard: yieldMt приходит как number (см. Command/Warhead), вызывающая
  // сторона (Simulation.applyCommand) обязана провалидировать его до вызова.
  // Проверяем ещё раз здесь — это последняя граница перед ANG_PATCH/YS, где
  // невалидное значение вернуло бы undefined и увело арифметику в NaN, необратимо
  // испортив c.alive (мутация на месте) и сломав детерминизм.
  if (!(YIELDS as readonly number[]).includes(yieldMt)) {
    throw new Error(
      `Недопустимая мощность заряда: ${yieldMt}. Разрешены только значения ${YIELDS.join(', ')} Мт.`,
    );
  }
  const key = yieldMt as YieldMt;
  const angPatch = ANG_PATCH[key];
  const ys = YS[key];
  const waveMaxAng = 0.45 * ys;

  const hits: CasualtyHit[] = [];
  let totalDeaths = 0;
  for (const c of cities) {
    if (c.alive <= 0.001) continue;
    const d = angleBetween(c.dir, dir);
    if (d > angPatch) continue;
    // в эпицентре гибнут все, к краю зоны — ~5%
    const frac = d <= angPatch * 0.4 ? 1 : 1 - ((d - angPatch * 0.4) / (angPatch * 0.6)) * 0.95;
    const deaths = c.alive * frac;
    c.alive -= deaths;
    const q = Math.min(1, d / waveMaxAng);
    const atWaveTime = 12 * (1 - Math.pow(1 - q, 1 / 1.8)) * ts;
    hits.push({ name: c.name, deaths, atWaveTime });
    totalDeaths += deaths;
  }
  return { hits, totalDeaths };
}
