// Stage 6e: ink-cloud page transition for the game pages. Entering a dojo: black ink clouds roll in
// from the edges, the dojo's medallion appears in the middle, then clouds and medallion clear.
// Other game pages get a short ink wipe. Nothing runs with effects off. Pure presentation.
import { sfx } from './sound.js';

const ASSETS = 'assets/theme/';
const ICONS = { quant: 'dojo_blade', varc: 'dojo_scroll', lrdi: 'dojo_shadow' };
const DURATION = { cover: 520, hold: 650, clear: 600 };

let current = null;

/**
 * Cover the screen with ink clouds (and the medallion for a dojo). Resolves once the screen is
 * covered, so the page can switch underneath; the clouds then clear on their own.
 */
export function inkTransition({ dojoKey = null } = {}) {
  if (current) current.cancel();
  const el = document.createElement('div');
  el.className = 'ink-transition' + (dojoKey ? ' with-medal' : '');
  el.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  el.append(canvas);
  if (dojoKey) {
    const medal = document.createElement('img');
    medal.src = `${ASSETS}icons/${ICONS[dojoKey]}.webp`;
    medal.alt = '';
    medal.className = 'ink-medal';
    medal.draggable = false;
    el.append(medal);
  }
  document.body.append(el);
  sfx.whoosh();

  const g = canvas.getContext('2d');
  const W = canvas.width = Math.round(innerWidth / 2);
  const H = canvas.height = Math.round(innerHeight / 2);
  // ink clouds: blobs that start outside the screen and roll in, then roll out the other way
  const rnd = (a, b) => a + Math.random() * (b - a);
  const blobs = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 4;
    const r = rnd(0.22, 0.42) * Math.max(W, H);
    blobs.push({
      r, phase: rnd(0, 6.28), wob: rnd(0.6, 1.4),
      x0: side === 0 ? -r : side === 1 ? W + r : rnd(0, W), y0: side === 2 ? -r : side === 3 ? H + r : rnd(0, H),
      x1: rnd(-0.1, 1.1) * W, y1: rnd(-0.1, 1.1) * H,
      x2: side === 1 ? -r * 1.2 : side === 0 ? W + r * 1.2 : rnd(0, W), y2: side === 3 ? -r * 1.2 : side === 2 ? H + r * 1.2 : rnd(0, H),
      shade: rnd(8, 26),
    });
  }
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const t0 = performance.now();
  const total = DURATION.cover + DURATION.hold + DURATION.clear;
  let raf = 0; let coveredResolve; let cancelled = false;
  const covered = new Promise((r) => { coveredResolve = r; });
  const frame = (now) => {
    const t = now - t0;
    g.clearRect(0, 0, W, H);
    let k; // 0 = off screen (start), 1 = covering, 2 = off screen (end)
    if (t < DURATION.cover) k = ease(t / DURATION.cover);
    else if (t < DURATION.cover + DURATION.hold) k = 1;
    else k = 1 + ease((t - DURATION.cover - DURATION.hold) / DURATION.clear);
    for (const b of blobs) {
      const x = k <= 1 ? b.x0 + (b.x1 - b.x0) * k : b.x1 + (b.x2 - b.x1) * (k - 1);
      const y = k <= 1 ? b.y0 + (b.y1 - b.y0) * k : b.y1 + (b.y2 - b.y1) * (k - 1);
      const wob = 1 + 0.06 * Math.sin(now / 400 * b.wob + b.phase);
      const grad = g.createRadialGradient(x, y, 0, x, y, b.r * wob);
      grad.addColorStop(0, `rgb(${b.shade} ${b.shade} ${b.shade + 10})`);
      grad.addColorStop(0.55, `rgb(${b.shade} ${b.shade} ${b.shade + 10} / 0.95)`);
      grad.addColorStop(1, 'rgb(10 10 20 / 0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, b.r * wob, 0, Math.PI * 2); g.fill();
    }
    if (t >= DURATION.cover && coveredResolve) { coveredResolve(); coveredResolve = null; el.classList.add('covered'); }
    if (t >= DURATION.cover + DURATION.hold) el.classList.add('clearing');
    if (t < total && !cancelled) raf = requestAnimationFrame(frame);
    else finish();
  };
  const finish = () => { cancelAnimationFrame(raf); el.remove(); if (coveredResolve) coveredResolve(); if (current === me) current = null; };
  const me = { cancel: () => { cancelled = true; finish(); } };
  current = me;
  raf = requestAnimationFrame(frame);
  return covered;
}
