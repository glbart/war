import { createRenderer } from './render/Renderer';
import { GameLoop } from './core/GameLoop';
import { GlobeView } from './render/GlobeView';
import { TileLayers } from './render/TileLayers';
import { CameraRig } from './input/CameraRig';
import { PointerController } from './input/PointerController';

const TILE_UPDATE_INTERVAL = 0.3; // секунд между реконсиляциями тайлов — дороже кадрового рендера

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

  // Освещение сцены (reference/earth-nuke.html строки ~76-79).
  // Больше источников света не добавляем — критично для производительности.
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.position.set(5, 2, 3);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8899aa, 1.5));

  // Глобус + атмосфера; дожидаемся готовности текстуры (или процедурного фолбэка),
  // прежде чем включать управление камерой и цикл рендера.
  const globe = new GlobeView(renderer.ctx);
  await globe.whenReady();

  const rig = new CameraRig(renderer.ctx, globe);
  const pointer = new PointerController(canvas, renderer.ctx, globe, rig, (dir) => {
    console.log('click dir:', dir);
  });

  // Тайлы спутниковых снимков + границ/названий поверх глобуса (Task 6).
  const tiles = new TileLayers(renderer.ctx, globe, rig);
  let tileAcc = 0;

  window.addEventListener('resize', () => renderer.resize(window.innerWidth, window.innerHeight));

  // Временный тумблер слоя названий/границ клавишей L — постоянную кнопку добавит Hud (Task 10).
  let labelsEnabled = true;
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'l') return;
    labelsEnabled = !labelsEnabled;
    tiles.setLabelsEnabled(labelsEnabled);
  });

  // Хуки для ручной проверки из headless-скриншотов/консоли (зум и число мешей тайлов).
  (
    window as unknown as { __setZoom: (v: number) => void; __tileMeshCount: () => number }
  ).__setZoom = (v: number) => {
    rig.zoom = v;
  };
  (
    window as unknown as { __setZoom: (v: number) => void; __tileMeshCount: () => number }
  ).__tileMeshCount = () => tiles.meshCount;

  const loop = new GameLoop(
    () => {}, // sim — появится позже
    (frame) => {
      rig.update(frame, pointer.isDown);
      tileAcc += frame;
      if (tileAcc >= TILE_UPDATE_INTERVAL) {
        tileAcc = 0;
        tiles.update();
      }
      renderer.render(frame);
    },
  );
  loop.start();
}

void boot();
