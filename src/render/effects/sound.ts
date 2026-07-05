// Синтезированный звук взрыва: затухающий фильтрованный шум + низкочастотный тон
// (порт boomSound()/ensureAudio() reference/earth-nuke.html ~600-636). Один общий
// AudioContext на всю игру, создаётся лениво по первому пользовательскому жесту —
// браузеры не дают запускать AudioContext без него (main.ts вызывает ensureAudio()
// на первый pointerdown, как в эталоне).
let audioCtx: AudioContext | null = null;

// Создаёт (или возобновляет, если был подвешен браузером) общий AudioContext.
// Безопасно вызывать многократно и до/после любого числа взрывов.
export function ensureAudio(): void {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return; // окружение без WebAudio (например, часть headless-конфигураций) — звук молча отключён
    }
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
}

// Масштаб громкости по мощности заряда (порт ys из detonate() ~724) — назван intensity
// в исходном boomSound(), сохраняем это соответствие в комментарии для трассируемости порта.
const YS_BY_YIELD: Record<number, number> = { 1: 0.6, 10: 1.0, 100: 1.7 };

// Проигрывает "бум" взрыва: 6-секундный шум с падающей ФНЧ-частотой поверх низкого тона
// с экспоненциально уходящей вниз частотой и громкостью. Если AudioContext ещё не создан
// (ensureAudio() не вызывался — не было пользовательского жеста), тихо ничего не делает.
export function playBoom(yieldMt: number): void {
  const ctx = audioCtx;
  if (!ctx) return;
  const intensity = YS_BY_YIELD[yieldMt] ?? 1;
  const t0 = ctx.currentTime;
  const dur = 6;

  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.6);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(700, t0);
  lp.frequency.exponentialRampToValueAtTime(35, t0 + dur);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.45 * intensity;
  noise.connect(lp).connect(noiseGain).connect(ctx.destination);
  noise.start(t0);

  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(60, t0);
  osc.frequency.exponentialRampToValueAtTime(24, t0 + dur);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.35 * intensity, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}
