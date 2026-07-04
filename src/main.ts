import { createRenderer } from './render/Renderer';
import { GameLoop } from './core/GameLoop';

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = createRenderer(canvas);
  await renderer.init();
  console.log('backend:', renderer.backend);

  const { THREE, scene } = renderer.ctx;
  // Звёзды — маркер того, что сцена рендерится.
  const positions = new Float32Array(2500 * 3);
  for (let i = 0; i < positions.length; i += 3) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 60);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55 })));

  window.addEventListener('resize', () => renderer.resize(window.innerWidth, window.innerHeight));

  const loop = new GameLoop(
    () => {}, // sim — появится позже
    () => renderer.render(0),
  );
  loop.start();
}

void boot();
