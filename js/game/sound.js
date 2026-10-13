// Stage 6e: optional sound, OFF by default (Settings → Samurai game → Sound). All sounds are
// synthesised here with the Web Audio API (no audio files, nothing downloaded): a soft ink
// "whoosh", a blade slash, a hit thud, a paper chime for the final card, and a gong for a rank-up.
import { getSetting } from '../db.js';

let ctx = null;
let enabled = null;

export async function soundOn() {
  if (enabled === null) enabled = await getSetting('game.sound', false);
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
};
