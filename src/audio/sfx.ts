/** Звуци, направени в кода (без файлове): изстрели, взривове, сандък, сливане, удари. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem('orda-mute') === '1'; } catch { /* */ }

export function audioUnlock() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() {
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('orda-mute', m ? '1' : '0'); } catch { /* */ }
  if (master) master.gain.value = m ? 0 : 0.55;
}

function noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', sweep = 0, delay = 0) {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 1, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// изстрелите се ограничават, за да не става каша при 9 оръжия
let shotBudget = 0;
let lastT = 0;
function allow(cost: number) {
  if (!ctx) return false;
  const now = ctx.currentTime;
  shotBudget = Math.max(0, shotBudget - (now - lastT) * 22);
  lastT = now;
  if (shotBudget > 6) return false;
  shotBudget += cost;
  return true;
}

export const sfx = {
  shot(kind: string) {
    switch (kind) {
      case 'light':
        if (!allow(1)) return;
        noise(0.07, 2600, 0.9, 0.35, 'bandpass', 0.4);
        tone(180, 0.05, 0.12, 'square', 0.5);
        break;
      case 'heavy':
        if (!allow(1.4)) return;
        noise(0.12, 1500, 0.8, 0.5, 'bandpass', 0.3);
        tone(110, 0.08, 0.22, 'square', 0.4);
        break;
      case 'shotgun':
        if (!allow(2)) return;
        noise(0.25, 900, 0.6, 0.7, 'lowpass', 0.25);
        tone(70, 0.15, 0.3, 'sawtooth', 0.4);
        break;
      case 'snipe':
        if (!allow(2)) return;
        noise(0.3, 3200, 1.2, 0.6, 'bandpass', 0.15);
        tone(240, 0.2, 0.18, 'sawtooth', 0.2);
        break;
      case 'rocket':
        if (!allow(1.5)) return;
        noise(0.45, 600, 0.7, 0.45, 'bandpass', 2.5);
        break;
      case 'pop':
        if (!allow(1.2)) return;
        tone(220, 0.12, 0.3, 'square', 0.4);
        noise(0.08, 700, 1, 0.3);
        break;
      case 'zap':
        if (!allow(0.6)) return;
        tone(900 + Math.random() * 300, 0.09, 0.08, 'sawtooth', 0.5);
        break;
    }
  },
  explosion() {
    noise(0.9, 500, 0.5, 1.0, 'lowpass', 0.15);
    tone(55, 0.6, 0.5, 'sine', 0.5);
  },
  splat() {
    if (!allow(0.3)) return;
    noise(0.09, 450 + Math.random() * 300, 2, 0.18, 'bandpass', 0.6);
  },
  hurt() {
    tone(150, 0.18, 0.35, 'square', 0.5);
    noise(0.12, 300, 1, 0.3, 'lowpass');
  },
  leap() {
    noise(0.35, 500, 1.5, 0.25, 'bandpass', 3);
  },
  land() {
    noise(0.1, 200, 1, 0.3, 'lowpass');
  },
  chest() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 0.22, 'triangle', 1, i * 0.07));
  },
  merge() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.3, 0.2, 'triangle', 1, i * 0.05));
    noise(0.4, 6000, 1, 0.12, 'highpass');
  },
  pick() {
    tone(660, 0.08, 0.18, 'triangle');
  },
  drop() {
    tone(330, 0.1, 0.18, 'triangle', 0.7);
  },
  wave() {
    tone(196, 0.5, 0.3, 'sawtooth', 1.02);
    tone(147, 0.6, 0.25, 'sawtooth', 1.0, 0.1);
  },
  boss() {
    tone(80, 1.2, 0.5, 'sawtooth', 0.6);
    noise(1.2, 300, 0.8, 0.4, 'lowpass', 0.3);
  },
  groan() {
    if (!ctx) return;
    const f = 90 + Math.random() * 60;
    tone(f, 0.7, 0.07, 'sawtooth', 0.7);
  },
  over() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 0.25, 'triangle', 1, i * 0.18));
  },
};
