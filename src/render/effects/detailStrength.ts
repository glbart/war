// Сила процедурной детализации суши по дистанции камеры до фрагмента: вблизи 1, вдали 0.
// Та же форма (smoothstep(far, near, dist)) применяется в TSL-шейдере GlobeView.
export function detailStrength(dist: number, near: number, far: number): number {
  const t = Math.min(1, Math.max(0, (dist - far) / (near - far)));
  return t * t * (3 - 2 * t);
}
