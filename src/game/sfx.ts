/**
 * Tiny synthesized sound effects (Web Audio). Nothing to download, so they
 * work offline and add zero bytes to the bundle. Muted by default.
 */
export type Sfx = 'jump' | 'coin' | 'death' | 'win' | 'click' | 'bounce' | 'stomp';

let ctx: AudioContext | null = null;
let muted = true;

export function setMuted(m: boolean): void {
  muted = m;
  if (!m) audio()?.resume().catch(() => {});
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, to: number, dur: number, type: OscillatorType, gain = 0.12, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.15): void {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export function play(s: Sfx): void {
  if (muted) return;
  switch (s) {
    case 'jump': return tone(320, 640, 0.14, 'square', 0.06);
    case 'bounce': return tone(200, 900, 0.25, 'triangle', 0.12);
    case 'coin': tone(988, 988, 0.07, 'square', 0.05); return tone(1319, 1319, 0.16, 'square', 0.05, 0.07);
    case 'stomp': return tone(180, 60, 0.12, 'square', 0.1);
    case 'death': noise(0.35, 0.2); return tone(300, 70, 0.4, 'sawtooth', 0.06);
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.09, i * 0.1)); return;
    case 'click': return tone(700, 500, 0.05, 'triangle', 0.05);
  }
}
