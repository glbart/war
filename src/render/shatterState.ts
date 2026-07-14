// Машина состояний раскола планеты (этап 4, спека 2026-07-14): intact → agony → shattered.
// Чистый TS без three — живёт в Scene, тестируется headless. Сценарий: trigger() при
// integrity()=0, агония SHATTER_AGONY_T секунд с линейным ростом boost (глобальный буст
// трещин 0→1), затем однократное событие 'shatter' (Scene скрывает планету и спавнит
// осколки), дальше — вечное shattered до reset().
import { SHATTER_AGONY_T } from '../assets/config';

export type ShatterPhase = 'intact' | 'agony' | 'shattered';

export class ShatterState {
  private _phase: ShatterPhase = 'intact';
  private agonyT = 0;

  get phase(): ShatterPhase {
    return this._phase;
  }

  // Глобальный буст трещин [0..1]: 0 в intact, линейный рост за агонию, 1 в shattered.
  get boost(): number {
    if (this._phase === 'intact') return 0;
    if (this._phase === 'shattered') return 1;
    return Math.min(1, this.agonyT / SHATTER_AGONY_T);
  }

  // Запуск агонии (integrity()=0). Повторные вызовы — no-op (агония не перезапускается).
  trigger(): void {
    if (this._phase === 'intact') this._phase = 'agony';
  }

  // Тик часов агонии. Возвращает 'shatter' РОВНО ОДИН РАЗ — в кадр перехода agony→shattered.
  update(dt: number): 'shatter' | null {
    if (this._phase !== 'agony') return null;
    this.agonyT += dt;
    if (this.agonyT < SHATTER_AGONY_T) return null;
    this._phase = 'shattered';
    return 'shatter';
  }

  reset(): void {
    this._phase = 'intact';
    this.agonyT = 0;
  }
}
