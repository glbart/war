// Машина состояний раскола планеты (этап 4, спека 2026-07-14, ревизия §6):
// intact → agony → shattered → collapse → gone. Чистый TS без three — живёт в Scene,
// тестируется headless. Сценарий: trigger() при integrity()=0; агония SHATTER_AGONY_T
// секунд с линейным ростом boost (глобальный буст трещин 0→1); событие 'shatter' (Scene
// подменяет глобус кусками); пауза SHATTER_CORE_LINGER_T (куски отходят, ядро обнажается);
// событие 'collapse' — распад ядра (вспышка+схлопывание за SHATTER_CORE_COLLAPSE_T,
// прогресс — coreProgress); gone — от планеты не осталось ничего. reset() из любой фазы.
import { SHATTER_AGONY_T, SHATTER_CORE_LINGER_T, SHATTER_CORE_COLLAPSE_T } from '../assets/config';

export type ShatterPhase = 'intact' | 'agony' | 'shattered' | 'collapse' | 'gone';
export type ShatterEvent = 'shatter' | 'collapse' | null;

export class ShatterState {
  private _phase: ShatterPhase = 'intact';
  private phaseT = 0; // часы ТЕКУЩЕЙ фазы (агония/пауза ядра/схлопывание)

  get phase(): ShatterPhase {
    return this._phase;
  }

  // Глобальный буст трещин [0..1]: 0 в intact, линейный рост за агонию, дальше — 1
  // (куски-плиты продолжают светиться жилами до самого конца).
  get boost(): number {
    if (this._phase === 'intact') return 0;
    if (this._phase === 'agony') return Math.min(1, this.phaseT / SHATTER_AGONY_T);
    return 1;
  }

  // Прогресс распада ядра [0..1]: 0 до collapse, рост за SHATTER_CORE_COLLAPSE_T, 1 в gone.
  get coreProgress(): number {
    if (this._phase === 'collapse') return Math.min(1, this.phaseT / SHATTER_CORE_COLLAPSE_T);
    return this._phase === 'gone' ? 1 : 0;
  }

  // Запуск агонии (integrity()=0). Повторные вызовы — no-op (агония не перезапускается).
  trigger(): void {
    if (this._phase === 'intact') this._phase = 'agony';
  }

  // Тик часов сценария. События возвращаются РОВНО ОДИН РАЗ: 'shatter' — кадр перехода
  // agony→shattered, 'collapse' — кадр начала распада ядра (shattered→collapse).
  update(dt: number): ShatterEvent {
    switch (this._phase) {
      case 'agony':
        this.phaseT += dt;
        if (this.phaseT < SHATTER_AGONY_T) return null;
        this._phase = 'shattered';
        this.phaseT = 0;
        return 'shatter';
      case 'shattered':
        this.phaseT += dt;
        if (this.phaseT < SHATTER_CORE_LINGER_T) return null;
        this._phase = 'collapse';
        this.phaseT = 0;
        return 'collapse';
      case 'collapse':
        this.phaseT += dt;
        if (this.phaseT >= SHATTER_CORE_COLLAPSE_T) {
          this._phase = 'gone';
          this.phaseT = 0;
        }
        return null;
      default:
        return null; // intact и gone — стабильные состояния
    }
  }

  reset(): void {
    this._phase = 'intact';
    this.phaseT = 0;
  }
}
