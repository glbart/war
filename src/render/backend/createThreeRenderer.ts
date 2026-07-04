import * as THREE from 'three/webgpu';

export type ThreeCtx = {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer;
};

// WebGPURenderer сам берёт WebGPU, иначе откатывается на WebGL2-бэкенд.
export async function createThreeCtx(canvas: HTMLCanvasElement): Promise<ThreeCtx> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2238);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(0, 0, 3.2);

  return { THREE, scene, camera, renderer };
}

// Тип `renderer.backend` в @types/three — базовый абстрактный класс Backend без
// поля isWebGPUBackend (оно объявлено только в конкретных WebGPUBackend/WebGLBackend).
// В рантайме three.js само же и читает `backend.isWebGPUBackend === true` повсеместно
// (см. three.webgpu.js), поэтому здесь безопасно сузить тип явным касом.
export function detectBackend(renderer: THREE.WebGPURenderer): 'webgpu' | 'webgl2' {
  const backend = renderer.backend as { isWebGPUBackend?: boolean } | null | undefined;
  return backend?.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}
