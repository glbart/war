import { createRenderer } from './render/Renderer';
import { GameLoop } from './core/GameLoop';
import { GlobeView } from './render/GlobeView';
import { TileLayers } from './render/TileLayers';
import { Scene } from './render/Scene';
import { CameraRig } from './input/CameraRig';
import { PointerController } from './input/PointerController';
import { LocalSimHost } from './sim/SimHost';

const TILE_UPDATE_INTERVAL = 0.3; // секунд между реконсиляциями тайлов — дороже кадрового рендера
const SIM_SEED = 1; // фиксированный seed локального хоста — воспроизводимость между запусками

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = createRenderer(canvas);
  await renderer.init();
  console.log('backend:', renderer.backend);

  const { THREE, scene: threeScene } = renderer.ctx;
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
  threeScene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55 })));

  // Освещение сцены (reference/earth-nuke.html строки ~76-79).
  // Больше источников света не добавляем — критично для производительности.
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.position.set(5, 2, 3);
  threeScene.add(sun);
  threeScene.add(new THREE.AmbientLight(0x8899aa, 1.5));

  // Глобус + атмосфера; дожидаемся готовности текстуры (или процедурного фолбэка),
  // прежде чем включать управление камерой и цикл рендера.
  const globe = new GlobeView(renderer.ctx);
  await globe.whenReady();

  const rig = new CameraRig(renderer.ctx, globe);

  // Симуляция (Task 7) живёт в локальном хосте: команды буферизуются между тиками,
  // события накапливаются до drainEvents() — сливаем их раз за кадр рендера.
  const host = new LocalSimHost(SIM_SEED);
  // Мощность заряда пока фиксирована — кнопки выбора мощности добавит Hud (Task 10),
  // тогда переменная снова станет let и будет обновляться по клику на кнопку.
  const currentYield = 10;
  const pointer = new PointerController(canvas, renderer.ctx, globe, rig, (dir) => {
    host.post({ kind: 'detonate', dir, yield: currentYield });
  });

  // Мост sim↔render: ракета (MissileView) + тряска камеры на взрыв; Explosion/Decal — Task 9-10.
  const scene = new Scene(renderer.ctx, globe, host, rig);

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

  // Временный хук для ручной/headless-проверки полёта ракеты (Task 8, Step 4) — удар
  // в точку экрана (по умолчанию — центр видимого диска); постоянный UI-триггер даст Hud
  // (Task 10). Необязательный dir позволяет прицелиться в конкретную точку из скриншот-теста.
  (
    window as unknown as { __strike: (dir?: { x: number; y: number; z: number }) => void }
  ).__strike = (dir) => {
    host.post({ kind: 'detonate', dir: dir ?? { x: 0, y: 0, z: 1 }, yield: currentYield });
  };

  // Прямой хук взрыва без ожидания полёта ракеты (Task 9, Step 4): порождает визуал взрыва
  // сразу в точке dir (по умолчанию центр видимого диска). Нужен, чтобы стресс-тест получил
  // 12 ОДНОВРЕМЕННЫХ взрывов, а скриншот — без 2.6с полёта. Не трогает симуляцию (чисто визуал).
  let boomSeed = 1;
  (
    window as unknown as {
      __boom: (yieldMt?: number, dir?: { x: number; y: number; z: number }) => void;
    }
  ).__boom = (yieldMt, dir) => {
    scene.startExplosion(dir ?? { x: 0, y: 0, z: 1 }, yieldMt ?? currentYield, boomSeed++);
  };

  // Счётчик времени кадра для стресс-теста: копит max/среднее по окну и выводит в консоль.
  // Включается из headless-проба через window.__perf.start()/stop().
  let perfOn = false;
  let perfCount = 0;
  let perfSum = 0;
  let perfMax = 0;
  (window as unknown as { __perf: { start: () => void; stop: () => void } }).__perf = {
    start: () => {
      perfOn = true;
      perfCount = 0;
      perfSum = 0;
      perfMax = 0;
    },
    stop: () => {
      perfOn = false;
      const avg = perfCount > 0 ? perfSum / perfCount : 0;
      console.log(`PERF frames=${perfCount} avgMs=${avg.toFixed(2)} maxMs=${perfMax.toFixed(2)}`);
    },
  };

  const loop = new GameLoop(
    (dt) => host.step(dt),
    (frame) => {
      const t0 = perfOn ? performance.now() : 0;
      // Сливаем события симуляции раз за кадр и раздаём всем потребителям (Scene, позже Hud) —
      // drainEvents() необратимо опустошает буфер, поэтому делаем это только здесь.
      const events = host.drainEvents();
      scene.handleEvents(events);

      scene.update(frame);
      rig.update(frame, pointer.isDown);
      tileAcc += frame;
      if (tileAcc >= TILE_UPDATE_INTERVAL) {
        tileAcc = 0;
        tiles.update();
      }
      renderer.render(frame);
      if (perfOn) {
        const ms = performance.now() - t0;
        perfCount++;
        perfSum += ms;
        if (ms > perfMax) perfMax = ms;
      }
    },
  );
  loop.start();
}

void boot();
