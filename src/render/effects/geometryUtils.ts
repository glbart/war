// Общий построитель патч-геометрии купола вокруг нормали — раньше был продублирован
// дословно в ExplosionView (ударная волна, RS/AS=40/96) и WaterBurstView (пенное кольцо,
// RS/AS=24/64). Один алгоритм, тесселяция параметризована аргументами RS/AS, поэтому обе
// вьюхи получают ровно ту же геометрию, что и раньше, вызывая эту функцию со своими
// константами.
import type * as THREE from 'three/webgpu';
import type { ThreeCtx } from '../Renderer';

// Тип рантайм-модуля three, который вьюхи получают через ctx.THREE (см. createThreeRenderer.ts).
// Передаём его явным параметром, а не импортируем three/webgpu как значение — так модуль
// остаётся согласован с тем, как ExplosionView/WaterBurstView берут THREE из ctx.
type ThreeModule = ThreeCtx['THREE'];

// Касательный базис из нормали n — пара единичных векторов, ортогональных n и друг другу.
// Нужен, чтобы развернуть патч-геометрию вокруг произвольной нормали на сфере.
export function orthoBasis(THREE: ThreeModule, n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const t1 =
    Math.abs(n.y) < 0.99
      ? new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize()
      : new THREE.Vector3(1, 0, 0);
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  return [t1, t2];
}

// Патч-купол вокруг нормали n: полуугол maxAng, радиус R, тесселяция RS (колец по радиусу) x
// AS (сегментов по углу). Атрибут aAng — доля углового расстояния до края (0 в центре, 1 на
// краю), нужен для бегущего фронта (ударная волна в ExplosionView, пенное кольцо в
// WaterBurstView). Строится один раз на мощность/вьюху в конструкторе — не звать в
// spawn()/update().
export function makeDomeGeometry(
  THREE: ThreeModule,
  n: THREE.Vector3,
  maxAng: number,
  R: number,
  RS: number,
  AS: number,
): THREE.BufferGeometry {
  const [t1, t2] = orthoBasis(THREE, n);
  const pos: number[] = [];
  const aAng: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= RS; j++) {
    const ang = (maxAng * j) / RS;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let i = 0; i <= AS; i++) {
      const phi = (2 * Math.PI * i) / AS;
      const p = n
        .clone()
        .multiplyScalar(ca)
        .addScaledVector(t1, Math.cos(phi) * sa)
        .addScaledVector(t2, Math.sin(phi) * sa)
        .multiplyScalar(R);
      pos.push(p.x, p.y, p.z);
      aAng.push(j / RS);
    }
  }
  const W = AS + 1;
  for (let j = 0; j < RS; j++) {
    for (let i = 0; i < AS; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aAng', new THREE.Float32BufferAttribute(aAng, 1));
  geo.setIndex(idx);
  return geo;
}
