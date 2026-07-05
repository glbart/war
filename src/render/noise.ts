// src/render/noise.ts
// Общий процедурный шум на TSL (value-noise + fbm) — единый источник для воды (OceanShell),
// микрорельефа кратера (GlobeView, 2A) и detail-слоя суши (2B). Перенос дублировавшихся
// hash/noise/fbm из OceanShell/GlobeView — тела дословны, поведение не меняется.
import { Fn, float, vec3, floor, fract, dot, cross, mix } from 'three/tsl';

// Узловые типы для аргументов TSL-функций (Fn): вытаскиваем Node<"float">/Node<"vec3"> из
// сигнатур dot/cross (единственные перегрузки → ReturnType точен), как в OceanShell/GlobeView.
type FloatNode = ReturnType<typeof dot>;
type Vec3Node = ReturnType<typeof cross>;

// ---------- шум (порт hash/noise/fbm из OceanShell/GlobeView на TSL Fn) ----------
// value-noise на основе хеша от целочисленной решётки; fbm — сумма октав с параметром их числа.
export const hash3 = Fn(([p]: [Vec3Node]) => {
  const q = fract(p.mul(0.3183099).add(0.1)).mul(17.0);
  return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
});

export const noise3 = Fn(([x]: [Vec3Node]) => {
  const i = floor(x);
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))); // сглаживание f*f*(3-2f)
  const c000 = hash3(i.add(vec3(0, 0, 0)));
  const c100 = hash3(i.add(vec3(1, 0, 0)));
  const c010 = hash3(i.add(vec3(0, 1, 0)));
  const c110 = hash3(i.add(vec3(1, 1, 0)));
  const c001 = hash3(i.add(vec3(0, 0, 1)));
  const c101 = hash3(i.add(vec3(1, 0, 1)));
  const c011 = hash3(i.add(vec3(0, 1, 1)));
  const c111 = hash3(i.add(vec3(1, 1, 1)));
  return mix(
    mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
    mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y),
    f.z,
  );
});

export const fbm3 = Fn(([p, octaves]: [Vec3Node, number]) => {
  let s: FloatNode = float(0);
  let pp: Vec3Node = p;
  let a = 0.5;
  for (let k = 0; k < octaves; k++) {
    s = s.add(noise3(pp).mul(a));
    pp = pp.mul(2.02);
    a *= 0.5;
  }
  return s;
});
