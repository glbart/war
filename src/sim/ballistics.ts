// Стилизованная баллистика МБР (спека 2026-07-14): путь = slerp(from,to,e)·(1+apex·sin(π·e)),
// апогей и время полёта растут с дальностью, e = k^BALLISTIC_EASE_POW — медленный разгон со
// старта и быстрый вход в атмосферу (профиль реальной МБР без интеграции гравитации).
// ЧИСТЫЙ TS: общий для симуляции (тайминги) и рендера (позиция каждый кадр), юнит-тестируем.
import type { Vec3 } from './geo';
import { angleBetween } from './geo';
import {
  BALLISTIC_APEX_MIN,
  BALLISTIC_APEX_SCALE,
  BALLISTIC_TIME_MIN,
  BALLISTIC_TIME_SCALE,
  BALLISTIC_EASE_POW,
} from '../assets/config';

// Сферическая интерполяция единичных векторов. На почти совпадающих направлениях
// (sin(ang)→0) — линейный фолбэк с нормировкой, без деления на ноль.
export function slerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ang = angleBetween(a, b);
  const s = Math.sin(ang);
  if (s < 1e-6) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  }
  const ka = Math.sin((1 - t) * ang) / s;
  const kb = Math.sin(t * ang) / s;
  return { x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb };
}

// Апогей дуги (в радиусах планеты) по угловой дальности: межконтинентальная — выше.
export function apexFor(angRad: number): number {
  return BALLISTIC_APEX_MIN + BALLISTIC_APEX_SCALE * (angRad / Math.PI);
}

// Время полёта (сек) по угловой дальности.
export function flightTimeFor(angRad: number): number {
  return BALLISTIC_TIME_MIN + BALLISTIC_TIME_SCALE * (angRad / Math.PI);
}

// Прогресс дуги по нормированному времени: медленный буст, быстрый вход (e=k^POW, POW>1).
export function easeBallistic(k: number): number {
  return Math.pow(Math.min(1, Math.max(0, k)), BALLISTIC_EASE_POW);
}

// Позиция боеголовки в момент k∈[0,1] нормированного времени полёта from→to
// (единичные направления). Высота — синус-дуга с апогеем apexFor(дальность) в середине.
export function ballisticPos(from: Vec3, to: Vec3, k: number): Vec3 {
  const e = easeBallistic(k);
  const p = slerp3(from, to, e);
  const h = 1 + apexFor(angleBetween(from, to)) * Math.sin(Math.PI * e);
  return { x: p.x * h, y: p.y * h, z: p.z * h };
}
