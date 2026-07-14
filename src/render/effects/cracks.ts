// Светящиеся трещины от глубоких очагов (этап 3, спека 2026-07-14): процедурные «жилы» —
// ridged fbm по направлению фрагмента (не зависит от разрешения поля урона — мыла на зуме
// нет), гейт — R-канал DamageField (сила очага со спадом от ямы), пульс — sin от общих часов.
// Общий узел для GlobeView (поверхность) и CrustView (воксельные чанки): рисунок зависит
// только от направления и поля — на границе дискарда глобус/чанк совпадает по построению.
import { vec3, float, clamp, sin, abs, oneMinus, smoothstep, dot, cross } from 'three/tsl';
import { fbm3 } from '../noise';
import {
  CRACK_FREQ,
  CRACK_EDGE0,
  CRACK_EDGE1,
  CRACK_COLOR,
  CRACK_INTENSITY,
} from '../../assets/config';

// Узловые типы как в noise.ts: Node<"float">/Node<"vec3"> из сигнатур dot/cross.
type FloatNode = ReturnType<typeof dot>;
type Vec3Node = ReturnType<typeof cross>;

// emissiveNode поддержан ВСЕМИ NodeMaterial в рантайме (NodeMaterial.setupLighting читает
// this.emissiveNode), но @types/three 0.185 объявляет его только у MeshStandardNodeMaterial.
// Точечный типобезопасный сеттер вместо any-кастов в каждом материале-потребителе.
export function setEmissiveNode(mat: object, node: Vec3Node): void {
  (mat as { emissiveNode: Vec3Node | null }).emissiveNode = node;
}

export function crackEmissiveNode(
  crackR: FloatNode,
  p: Vec3Node,
  uTime: FloatNode,
  boost: FloatNode,
): Vec3Node {
  // Глобальный буст (агония раскола, этап 4): жилы разгораются по всей планете.
  const effCrack = clamp(crackR.add(boost), 0, 1);
  // Ридж: жилы там, где fbm проходит через середину диапазона (|2x−1|→0).
  const ridge = oneMinus(abs(fbm3(p.mul(CRACK_FREQ), 4).mul(2).sub(1)));
  const veins = smoothstep(float(CRACK_EDGE0), float(CRACK_EDGE1), ridge);
  const pulse = float(0.78).add(sin(uTime.mul(1.7)).mul(0.22));
  const glow = clamp(veins.mul(effCrack).mul(pulse).mul(CRACK_INTENSITY), 0, CRACK_INTENSITY);
  return vec3(CRACK_COLOR[0], CRACK_COLOR[1], CRACK_COLOR[2]).mul(glow);
}
