import { createRenderer } from './render/Renderer';
import { GameLoop } from './core/GameLoop';
import { GlobeView } from './render/GlobeView';
import { DamageField } from './render/DamageField';
import { HoleMask } from './render/HoleMask';
import { TileLayers } from './render/TileLayers';
import { Scene } from './render/Scene';
import { MapView } from './render/MapView';
import { CameraRig } from './input/CameraRig';
import { PointerController } from './input/PointerController';
import { LocalSimHost } from './sim/SimHost';
import { Hud } from './ui/Hud';
import { StartMenu } from './ui/StartMenu';
import { HelpPanel } from './ui/HelpPanel';
import { initVersionInfo } from './ui/VersionInfo';
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

  // Поле урона планеты (Task 7): equirect RGBA8 — заполняется splat() в Scene (Task 9),
  // здесь только создаём и прокидываем текстуру в материал глобуса.
  const damageField = new DamageField(renderer.ctx);
  // Маска дырок коры (Task 8): равнина, куда врезаются воксельные чанки CrustView — глобус
  // discard'ит эти регионы; Scene (Task 10) помечает их при carve через CrustView.
  const holeMask = new HoleMask(renderer.ctx);

  // Глобус + атмосфера; дожидаемся готовности текстуры (или процедурного фолбэка),
  // прежде чем включать управление камерой и цикл рендера.
  const globe = new GlobeView(renderer.ctx, damageField.texture, holeMask.texture);
  await globe.whenReady();

  const rig = new CameraRig(renderer.ctx, globe);

  // Симуляция живёт в локальном хосте: команды буферизуются между тиками, события
  // накапливаются до drainEvents() — сливаем их раз за кадр рендера и раздаём Scene и Hud.
  const host = new LocalSimHost(SIM_SEED);
  const hud = new Hud(host);
  initVersionInfo(); // бейдж версии + окно «Что нового» при первом открытии новой версии

  // Стартовое меню и справка (спека 2026-08-30-onboarding-ui-design): партия НЕ начинается
  // сама. Пока меню или справка открыты, симуляция не тикает — таймер кампании не должен
  // идти, пока человек читает правила. Пауза здесь клиентская: симуляция о ней не знает,
  // шов Command → Simulation → Events не трогается.
  const menu = new StartMenu();
  const help = new HelpPanel();
  let paused = true;
  const resume = () => {
    paused = false;
  };
  menu.onStart = ({ side, scenario }) => {
    // Сценарий задаёт стартовые условия и сам сбрасывает партию, сторона идёт следом:
    // обе команды попадают в один буфер и применятся по порядку на первом же тике.
    host.post({ kind: 'setScenario', scenario });
    hud.setSide(side);
    resume();
  };
  menu.onResume = resume;
  menu.onHelp = () => help.open();
  help.onClose = () => {
    // Из справки возвращаемся туда, откуда пришли: меню открыто — партия ждёт дальше.
    if (!menu.isOpen) resume();
  };
  hud.onPause = () => {
    paused = true;
    menu.open('pause');
  };
  hud.onHelp = () => {
    paused = true;
    help.open();
  };

  // Dev-инструменты headless-приёмки (__strike/__reset/__lookAt на window) — только
  // в dev-сборке; динамический импорт под import.meta.env.DEV гарантирует, что Vite
  // вырежет модуль и хуки из прод-бандла (dead-code elimination).
  if (import.meta.env.DEV) {
    const { installDevHooks, installHudHook } = await import('./debug/devHooks');
    installDevHooks(host, globe);
    installHudHook(hud);
  }

  // Первый пользовательский жест разрешает WebAudio (браузеры не дают запустить
  // AudioContext без него) — как в эталоне (ensureAudio() на pointerdown).
  window.addEventListener('pointerdown', () => ensureAudio(), { once: true });

  // Клик по глобусу → detonate с мощностью и стороной, выбранными в Hud (сторона нужна для
  // атрибуции ответного удара: жертва мстит именно ей; «случайно» → анонимный удар).
  const pointer = new PointerController(canvas, renderer.ctx, globe, rig, (dir) => {
    host.post({ kind: 'detonate', dir, yield: hud.currentYield, faction: hud.currentSide });
  });

  // Мост sim↔render: ракеты, взрывы (огонь/волна/частицы), кратеры-декали, тряска камеры, звук.
  const scene = new Scene(renderer.ctx, globe, host, rig, damageField, holeMask);

  // Плоская политическая карта: своя сцена и ортокамера, переключается кнопкой HUD или «M».
  // Реальные границы Natural Earth, заливка по сторонам (спека 2026-08-29-flat-map-design.md).
  const map = new MapView(renderer.ctx);
  map.resize(window.innerWidth, window.innerHeight);
  let mapMode = false;
  const setMapMode = (on: boolean) => {
    mapMode = on;
    renderer.setViewOverride(on ? { scene: map.scene, camera: map.camera } : undefined);
    pointer.enabled = !on;
    hud.setMapMode(on);
  };
  hud.onToggleMap = () => setMapMode(!mapMode);
  hud.onProgramSelect = (id) => map.setHighlight(id);
  if (import.meta.env.DEV) {
    const { installMapHook } = await import('./debug/devHooks');
    installMapHook(map);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') setMapMode(!mapMode);
    // Esc — пауза и меню, H — справка (обе клавиши названы в подсказке HUD и в правилах).
    if (e.key === 'Escape') {
      if (help.isOpen) help.close();
      else if (menu.isOpen) menu.requestClose();
      else {
        paused = true;
        menu.open('pause');
      }
    }
    if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
      if (help.isOpen) help.close();
      else {
        paused = true;
        help.open();
      }
    }
  });

  // Управление картой: драг — панорама, колесо — зум, клик — удар по точке (та же команда,
  // что и с глобуса). Глобусный контроллер на это время выключен.
  let mapDown = false;
  let mapDragged = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!mapMode) return;
    mapDown = true;
    mapDragged = false;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!mapMode || !mapDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) mapDragged = true;
    map.panBy(dx, dy, window.innerHeight);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!mapMode) return;
    mapDown = false;
    if (mapDragged) return;
    // Shift+клик выбирает страну под курсором как цель инструментов, обычный клик — удар.
    if (e.shiftKey) {
      const owner = map.factionAtScreen(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight,
      );
      hud.selectProgramExternal(owner);
      return;
    }
    const dir = map.pick(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    if (dir)
      host.post({ kind: 'detonate', dir, yield: hud.currentYield, faction: hud.currentSide });
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!mapMode) return;
      e.preventDefault();
      map.zoomBy(e.deltaY * 0.0012);
    },
    { passive: false },
  );

  // Dev-зонд поля воды (__waterStats) — как и installDevHooks, только в dev-сборке.
  if (import.meta.env.DEV) {
    const { installWaterProbe } = await import('./debug/devHooks');
    installWaterProbe(scene);
  }

  // Тайлы спутниковых снимков + границ/названий поверх глобуса.
  const tiles = new TileLayers(renderer.ctx, globe, rig);
  let tileAcc = 0;

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
    map.resize(window.innerWidth, window.innerHeight);
  });

  // Dev-хук приёмки: пропустить меню и начать партию сразу (scripts/accept/shots.mjs
  // снимает кадры глобуса, ему стартовый оверлей только мешает). Только dev-сборка.
  if (import.meta.env.DEV) {
    const { installStartHook } = await import('./debug/devHooks');
    installStartHook(() => {
      menu.close();
      help.close();
      hud.setSide('usa');
      resume();
    });
  }

  const loop = new GameLoop(
    // Пока открыто меню или справка, симуляция стоит: рендер продолжается (глобус крутится
    // фоном), но время партии не идёт.
    (dt) => {
      if (!paused) host.step(dt);
    },
    (frame) => {
      // Сливаем события симуляции раз за кадр и раздаём всем потребителям (Scene, Hud, слой
      // тайлов) — drainEvents() необратимо опустошает буфер, поэтому делаем это только здесь.
      const events = host.drainEvents();
      scene.handleEvents(events);
      for (const event of events) {
        hud.onEvent(event);
        if (event.kind === 'labelsToggled') tiles.setLabelsEnabled(event.enabled);
        // Карта живёт теми же событиями, что и глобус: города гаснут синхронно.
        if (event.kind === 'cityHit') map.setCityAlive(event.name, event.alive);
        if (event.kind === 'planetReset') map.clearCities();
      }

      scene.update(frame);
      hud.setIntegrity(scene.crustIntegrity);
      hud.setShattered(scene.isShattered);
      tiles.setVisible(!scene.isShattered);
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
