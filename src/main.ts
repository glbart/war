import { createRenderer } from './render/Renderer';
import { GameLoop } from './core/GameLoop';
import { GlobeView } from './render/GlobeView';
import { TileLayers } from './render/TileLayers';
import { Scene } from './render/Scene';
import { CameraRig } from './input/CameraRig';
import { PointerController } from './input/PointerController';
import { LocalSimHost } from './sim/SimHost';
import { Hud } from './ui/Hud';
import { ensureAudio } from './render/effects/sound';

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

  // Симуляция живёт в локальном хосте: команды буферизуются между тиками, события
  // накапливаются до drainEvents() — сливаем их раз за кадр рендера и раздаём Scene и Hud.
  const host = new LocalSimHost(SIM_SEED);
  const hud = new Hud(host);

  // Первый пользовательский жест разрешает WebAudio (браузеры не дают запустить
  // AudioContext без него) — как в эталоне (ensureAudio() на pointerdown).
  window.addEventListener('pointerdown', () => ensureAudio(), { once: true });

  // Клик по глобусу → detonate с мощностью, выбранной кнопками Hud.
  const pointer = new PointerController(canvas, renderer.ctx, globe, rig, (dir) => {
    host.post({ kind: 'detonate', dir, yield: hud.currentYield });
  });

  // Мост sim↔render: ракеты, взрывы (огонь/волна/частицы), кратеры-декали, тряска камеры, звук.
  const scene = new Scene(renderer.ctx, globe, host, rig);

  // Тайлы спутниковых снимков + границ/названий поверх глобуса.
  const tiles = new TileLayers(renderer.ctx, globe, rig);
  let tileAcc = 0;

  window.addEventListener('resize', () => renderer.resize(window.innerWidth, window.innerHeight));

  const loop = new GameLoop(
    (dt) => host.step(dt),
    (frame) => {
      // Сливаем события симуляции раз за кадр и раздаём всем потребителям (Scene, Hud, слой
      // тайлов) — drainEvents() необратимо опустошает буфер, поэтому делаем это только здесь.
      const events = host.drainEvents();
      scene.handleEvents(events);
      for (const event of events) {
        hud.onEvent(event);
        if (event.kind === 'labelsToggled') tiles.setLabelsEnabled(event.enabled);
      }

      scene.update(frame);
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
