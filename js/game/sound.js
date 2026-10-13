// Stage 6e: sound, ON by default for a new user (Settings → Samurai game → Sound switches it off). All sounds are
// synthesised here with the Web Audio API (no audio files, nothing downloaded): a soft ink
// "whoosh", a blade slash, a hit thud, a paper chime for the final card, and a gong for a rank-up.
import { getSetting } from '../db.js';
import { gameOnByDefault } from './defaults.js';

let ctx = null;
let enabled = null;

export async function soundOn() {
  if (enabled === null) enabled = await getSetting('game.sound', gameOnByDefault());
  return enabled;
}
export function setSoundOn(on) { enabled = !!on; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function noise(dur, { from = 4000, to = 300, gain = 0.25, type = 'lowpass' } = {}) {
  const c = ac();
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(from, c.currentTime); f.frequency.exponentialRampToValueAtTime(to, c.currentTime + dur);
  const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(c.destination); src.start();
}

function tone(freq, dur, { gain = 0.2, type = 'sine', slide = null, delay = 0 } = {}) {
  const c = ac();
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + delay);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + delay + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime + delay);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + delay + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
  o.connect(g); g.connect(c.destination); o.start(c.currentTime + delay); o.stop(c.currentTime + delay + dur + 0.05);
}

const play = async (fn) => { try { if (await soundOn()) fn(); } catch { /* audio blocked or unsupported: stay silent */ } };

export const sfx = {
  whoosh: () => play(() => noise(0.5, { from: 1200, to: 200, gain: 0.18 })),
  slash: () => play(() => { noise(0.22, { from: 6000, to: 800, gain: 0.3, type: 'bandpass' }); tone(1800, 0.12, { gain: 0.08, type: 'triangle', slide: 300 }); }),
  hit: () => play(() => { tone(140, 0.25, { gain: 0.35, type: 'square', slide: 40 }); noise(0.3, { from: 800, to: 80, gain: 0.3 }); }),
  chime: () => play(() => { [660, 880, 1320].forEach((f, i) => tone(f, 0.5, { gain: 0.12, delay: i * 0.09 })); }),
  gong: () => play(() => { tone(196, 2.2, { gain: 0.3 }); tone(392, 1.6, { gain: 0.12, delay: 0.02 }); tone(587, 1.2, { gain: 0.06, delay: 0.05 }); }),
  tap: () => play(() => tone(900, 0.06, { gain: 0.06, type: 'triangle' })),
  // interface sounds (very quiet; never on the test screen — callers check that)
  tok: () => play(() => { tone(520, 0.05, { gain: 0.035, type: 'triangle', slide: 380 }); noise(0.03, { from: 2500, to: 900, gain: 0.02, type: 'bandpass' }); }),
  rustle: () => play(() => noise(0.28, { from: 5000, to: 1800, gain: 0.04, type: 'highpass' })),
  swish: () => play(() => noise(0.32, { from: 2600, to: 400, gain: 0.05, type: 'bandpass' })),
  // a red seal stamp landing on paper
  stamp: () => play(() => { tone(110, 0.18, { gain: 0.3, type: 'sine', slide: 60 }); noise(0.12, { from: 1500, to: 200, gain: 0.18 }); }),
  // a short calm melody (koto-like plucks on a pentatonic scale) after a good result
  melody: () => play(() => { [392, 440, 523.25, 587.33, 783.99, 659.25].forEach((f, i) => pluck(f, 0.9, i * 0.22, 0.09)); }),
};

/** A plucked-string note (koto-like): bright attack, quick decay, a little octave shimmer. */
function pluck(freq, dur, delay, gain) {
  const c = ac();
  const t = c.currentTime + delay;
  for (const [mul, gg, type] of [[1, gain, 'triangle'], [2, gain * 0.25, 'sine']]) {
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq * mul, t);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gg, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
}

// ---------- 11. ambient sound per dojo (own on/off switch: Settings → "Dojo ambience") ----------
let ambientOn = null;
export async function ambienceOn() {
  if (ambientOn === null) ambientOn = await getSetting('game.ambient', gameOnByDefault());
  return ambientOn;
}
export function setAmbienceOn(on) { ambientOn = !!on; if (!on) stopAmbient(); }
let amb = null;
/** Start the dojo's background sound, fading in: forge crackle, bamboo wind, or crickets. */
export async function startAmbient(key) {
  stopAmbient();
  try {
    if (!(await soundOn()) || !(await ambienceOn())) return;
    const c = ac();
    const master = c.createGain(); master.gain.setValueAtTime(0.0001, c.currentTime); master.gain.exponentialRampToValueAtTime(1, c.currentTime + 2.5);
    master.connect(c.destination);
    const loopNoise = (seconds = 4) => { const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = buf; s.loop = true; return s; };
    const nodes = []; const timers = [];
    if (key === 'varc') {
      // bamboo wind: soft low noise whose loudness and colour breathe slowly
      const n = loopNoise(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = c.createGain(); g.gain.value = 0.035;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain);
      const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.05; const lg2 = c.createGain(); lg2.gain.value = 250; lfo2.connect(lg2); lg2.connect(f.frequency);
      n.connect(f); f.connect(g); g.connect(master); n.start(); lfo.start(); lfo2.start();
      nodes.push(n, lfo, lfo2);
    } else if (key === 'quant') {
      // forge: a low roar and random crackles
      const n = loopNoise(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const g = c.createGain(); g.gain.value = 0.05; n.connect(f); f.connect(g); g.connect(master); n.start(); nodes.push(n);
      const crackle = () => { if (!amb) return; const t = c.currentTime; const o = c.createBufferSource(); const b = c.createBuffer(1, Math.ceil(c.sampleRate * 0.03), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); o.buffer = b; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; const cg = c.createGain(); cg.gain.value = 0.03 + Math.random() * 0.05; o.connect(hp); hp.connect(cg); cg.connect(master); o.start(t); timers.push(setTimeout(crackle, 80 + Math.random() * 520)); };
      timers.push(setTimeout(crackle, 300));
    } else if (key === 'lrdi') {
      // night: crickets chirping in short pulses, now and then
      const chirp = () => { if (!amb) return; const t = c.currentTime; for (let k = 0; k < 3; k++) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 4300 + Math.random() * 300; const g = c.createGain(); const s = t + k * 0.07; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.012, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.05); o.connect(g); g.connect(master); o.start(s); o.stop(s + 0.06); } timers.push(setTimeout(chirp, 600 + Math.random() * 1600)); };
      timers.push(setTimeout(chirp, 500));
    }
    amb = { master, nodes, timers, c };
  } catch { amb = null; }
}
export function stopAmbient() {
  if (!amb) return;
  const { master, nodes, timers, c } = amb;
  amb = null;
  timers.forEach(clearTimeout);
  try { master.gain.cancelScheduledValues(c.currentTime); master.gain.setValueAtTime(master.gain.value || 0.5, c.currentTime); master.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.8); } catch { /* ignore */ }
  setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } } try { master.disconnect(); } catch { /* ignore */ } }, 900);
}
