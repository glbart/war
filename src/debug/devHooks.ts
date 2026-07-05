import type { SimHost } from '../sim/SimHost';
import type { GlobeView } from '../render/GlobeView';
import { lonLatToDir } from '../sim/geo';

// Dev-инструменты headless-приёмки (Task 12): вешают на window хуки для нанесения ударов,
// сброса симуляции и наведения камеры без ручного взаимодействия с UI. Используются
// скриптом scripts/accept/shots.mjs через CDP Runtime.evaluate. Подключаются ТОЛЬКО в
// dev-сборке (main.ts вызывает это под import.meta.env.DEV) — в прод-бандл не попадают.
export function installDevHooks(host: SimHost, globe: GlobeView): void {
  const w = window as unknown as Record<string, unknown>;

  // __strike(lonDeg, latDeg, yield) — нанести удар по координатам в градусах.
  w.__strike = (lonDeg: number, latDeg: number, y: number) =>
    host.post({
      kind: 'detonate',
      dir: lonLatToDir((lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180),
      yield: y,
    });

  // __reset() — сбросить симуляцию в начальное состояние.
  w.__reset = () => host.post({ kind: 'reset' });

  // __lookAt(lonDeg, latDeg) — довернуть глобус так, чтобы точка оказалась в кадре
  // детерминированно, без ожидания автоповорота при простое.
  w.__lookAt = (lonDeg: number, latDeg: number) => {
    const latRad = (latDeg * Math.PI) / 180;
    const dir = lonLatToDir((lonDeg * Math.PI) / 180, latRad);
    globe.spinGroup.rotation.y = Math.atan2(-dir.x, dir.z);
    globe.tiltGroup.rotation.x = latRad;
  };
}
