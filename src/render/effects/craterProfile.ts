// Чистый радиальный профиль кратера (источник истины формы для TSL-штампа DamageField и тестов).
// Аргумент dNorm = d / uRadius: 0 — центр, 1 — край чаши, >1 — снаружи (вал/эжекта).
import {
  CRATER_RIM_FRAC,
  CRATER_RIM_WIDTH_FRAC,
  CRATER_EJECTA_FRAC,
  CRATER_SCORCH_FRAC,
} from '../../assets/config';

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function craterProfile(dNorm: number): {
  depth: number;
  rim: number;
  ejecta: number;
  scorch: number;
} {
  // Чаша: 1 в центре → 0 к краю (dNorm=1).
  const depth = smoothstep(1, 0, dNorm);
  // Вал: гаусс с центром CRATER_RIM_FRAC, шириной CRATER_RIM_WIDTH_FRAC.
  const rimX = (dNorm - CRATER_RIM_FRAC) / CRATER_RIM_WIDTH_FRAC;
  const rim = Math.exp(-rimX * rimX);
  // Эжекта: кольцо СНАРУЖИ чаши. Первый smoothstep — спад от вала к CRATER_EJECTA_FRAC,
  // второй (внутренний ramp) — обнуляет её ниже вала (внутри чаши эжекты нет, это не диск).
  const ejecta =
    smoothstep(CRATER_EJECTA_FRAC, CRATER_RIM_FRAC, dNorm) * smoothstep(1, CRATER_RIM_FRAC, dNorm);
  // Гарь: широкий мягкий градиент до CRATER_SCORCH_FRAC.
  const scorch = smoothstep(CRATER_SCORCH_FRAC, 0, dNorm);
  return { depth, rim, ejecta, scorch };
}
