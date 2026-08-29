// Кривые отклика Utility AI (спека 2026-08-29-utility-ai-design.md §2): сырой вход 0..1
// превращается в полезность 0..1. Кривые — ДАННЫЕ (параметры m/k/b/c), а не ветки кода:
// именно поэтому баланс крутится числами, а не переписыванием логики.

// y = m·(x−c)^k + b — линейная (k=1), квадратичная (k=2), корневая (k=0.5)
// y = k/(1+e^(−m·(x−c))) + b — логистическая S-образная (плавный порог)
// step — жёсткое вето/разрешение: 0 до порога, 1 после
export type Curve =
  | { kind: 'poly'; m: number; k: number; b: number; c: number }
  | { kind: 'logistic'; m: number; k: number; b: number; c: number }
  | { kind: 'step'; c: number };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Значение кривой в точке x (вход клампится в 0..1, выход тоже — соображение всегда 0..1).
export function evalCurve(curve: Curve, x: number): number {
  const t = clamp01(x);
  switch (curve.kind) {
    case 'poly': {
      // Основание степени берём неотрицательным: дробная степень от минуса даёт NaN.
      const base = Math.max(0, t - curve.c);
      return clamp01(curve.m * Math.pow(base, curve.k) + curve.b);
    }
    case 'logistic':
      return clamp01(curve.k / (1 + Math.exp(-curve.m * (t - curve.c))) + curve.b);
    case 'step':
      return t >= curve.c ? 1 : 0;
  }
}

// ---- Готовые формы, которыми описан стартовый набор соображений ----

// Прямая 0→1.
export const RISING: Curve = { kind: 'poly', m: 1, k: 1, b: 0, c: 0 };
// Прямая 1→0.
export const FALLING: Curve = { kind: 'poly', m: -1, k: 1, b: 1, c: 0 };
// Медленный старт, резкий рост к единице (для «боли»: первые проценты потерь терпимы).
export const SLOW_THEN_FAST: Curve = { kind: 'poly', m: 1, k: 2, b: 0, c: 0 };
// Быстрое насыщение (для «обиды»: первый же удар почти исчерпывает шкалу).
export const FAST_SATURATE: Curve = { kind: 'poly', m: 1, k: 0.5, b: 0, c: 0 };

// S-образная с центром center: до него почти ноль, после — почти единица.
export function sCurve(center: number, steepness = 10): Curve {
  return { kind: 'logistic', m: steepness, k: 1, b: 0, c: center };
}

// Вето/разрешение по порогу.
export function threshold(c: number): Curve {
  return { kind: 'step', c };
}

// Оценка варианта: ПРОИЗВЕДЕНИЕ соображений — любой ноль обнуляет вариант целиком (вето),
// плюс компенсация схлопывания: без неё вариант с шестью соображениями всегда проигрывает
// варианту с двумя. Формула компенсации — из Infinite Axis Utility System.
export function combineScore(values: number[]): number {
  if (values.length === 0) return 0;
  let product = 1;
  for (const v of values) {
    if (v <= 0) return 0; // вето: дальше считать нечего
    product *= clamp01(v);
  }
  const modFactor = 1 - 1 / values.length;
  return clamp01(product + (1 - product) * modFactor * product);
}
