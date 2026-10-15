// Premium touches (user's list, 2026-10-14): brush-stroke page changes, cards that unroll into
// view, numbers that count up, phone vibration, time of day, start screen. (The 3D tilt and the new
// sounds were removed at the user's request the same day.)
// More (user, 2026-10-15, "other pages, more animations"): titles written in with a brush, bars that
// grow, charts that draw themselves, table rows that slide in, an ink drop where you click, a soft
// light that follows the mouse over cards, a gold reading line at the top, embers in the background.
// All of it runs only when the game's effects are on (body.fx-on: game on, "Reduce effects" off,
// no reduce-motion), never on the test screen (body.in-exam). Pure presentation.

export const fxOn = () => document.body.classList.contains('fx-on') && !document.body.classList.contains('in-exam');

/** Turn the effects class on or off (main.js, Settings). */
export function setFx(on) {
  document.body.classList.toggle('fx-on', !!on);
  if (on) { startEnhancer(); startPointerFx(); startScrollLine(); startEmbers(); } else { stopEnhancer(); stopPointerFx(); stopScrollLine(); stopEmbers(); }
}

// ---------- 1. brush-stroke page change ----------
let wiping = null;
/** A quick ink brush stroke sweeps across; resolves when the screen is covered (~0.2 s). */
export function brushWipe() {
  if (!fxOn()) return Promise.resolve();
  if (wiping) wiping.remove();
  const el = document.createElement('div');
  el.className = 'brush-wipe';
  el.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) { const s = document.createElement('span'); s.style.setProperty('--i', i); el.append(s); }
  document.body.append(el);
  wiping = el;
  setTimeout(() => { el.classList.add('out'); }, 230);
  setTimeout(() => { el.remove(); if (wiping === el) wiping = null; }, 620);
  return new Promise((r) => setTimeout(r, 200));
}

// ---------- 2 + 5. reveal and count-up (watched on every page) ----------
const REVEAL = '.section-card, .test-row, .card, .washi, .res-card, .res-panel, .gate, .best, .hall-badge, .advice > li, .cal-stat, .qcard, .score-table, .res-fold';
const COUNT = '.t-num, .section-count, .best-v, .res-card-value, #total-power, .gate-power strong';
// things that animate when they come into view: bars grow, lines draw, the radar grows, the
// calendar fills in, table rows slide in one after another
const GROW = '.speed-fill, .g-bar-fill, .mb-fill, .mt-track > *';
const DRAW = 'svg.trend polyline.series, svg.mock-line polyline.ml';
const SHAPES = 'svg.radar2, svg.heatmap2, svg.trend, svg.mock-line';
const ROWS = 'table.res-table, table.q-table, table.g-table';
let mo = null; let io = null; let stagger = 0; let staggerTimer = 0;

function startEnhancer() {
  if (mo) return;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target;
      const delay = Math.min(stagger++, 8) * 55;
      clearTimeout(staggerTimer); staggerTimer = setTimeout(() => { stagger = 0; }, 400);
      setTimeout(() => { el.classList.add('in'); if (el.matches(COUNT) || el.querySelector(COUNT)) countUpIn(el); settle(el); }, delay);
    }
  }, { threshold: 0.08 });
  const take = (node) => {
    if (!(node instanceof Element) || !fxOn()) return;
    takeMotion(node);
    const els = [...(node.matches(REVEAL) ? [node] : []), ...node.querySelectorAll(REVEAL)];
    for (const el of els) {
      if (el.dataset.fxSeen) continue;
      el.dataset.fxSeen = '1';
      if (el.closest('.exam, dialog, .battle-overlay')) continue;
      el.classList.add('reveal');
      io.observe(el);
      // safety: whatever happens, a card is never left hidden
      setTimeout(() => { if (!el.classList.contains('in')) { el.classList.add('in'); settle(el); } }, 1500);
    }
  };
  mo = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) take(n); });
  const root = document.getElementById('app');
  mo.observe(root, { childList: true, subtree: true });
  take(root);
}
/** Once a card has unrolled, give it back its own style (so its hover lift and shadows work). */
function settle(el) { setTimeout(() => el.classList.remove('reveal', 'in'), 700); }

function stopEnhancer() {
  if (mo) mo.disconnect(); if (io) io.disconnect(); if (motionIo) motionIo.disconnect();
  mo = null; io = null; motionIo = null;
  for (const el of document.querySelectorAll('.reveal')) el.classList.add('in');
  for (const el of document.querySelectorAll('.fx-wait')) el.classList.remove('fx-wait');
}

// ---------- 17-19. growing bars, self-drawing charts, rows sliding in ----------
let motionIo = null;
function takeMotion(node) {
  if (!motionIo) {
    motionIo = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { motionIo.unobserve(e.target); play(e.target); }
    }, { threshold: 0.15 });
  }
  const all = (sel) => [...(node.matches(sel) ? [node] : []), ...node.querySelectorAll(sel)];
  for (const el of [...all(GROW), ...all(SHAPES), ...all(ROWS)]) {
    if (el.dataset.fxMotion || el.closest('.exam, dialog, .battle-overlay')) continue;
    el.dataset.fxMotion = '1';
    el.classList.add('fx-wait');
    motionIo.observe(el);
    setTimeout(() => { if (el.classList.contains('fx-wait')) play(el); }, 2500); // never left hidden
  }
}
function play(el) {
  if (!el.classList.contains('fx-wait')) return;
  if (el.matches(SHAPES)) {
    // lines draw from left to right; the calendar squares fill in column by column
    for (const line of el.querySelectorAll(DRAW)) {
      try { line.style.setProperty('--len', String(Math.ceil(line.getTotalLength()) + 2)); } catch { /* not drawn yet */ }
    }
    if (el.matches('svg.heatmap2')) {
      const xs = [...new Set([...el.querySelectorAll('rect.hm')].map((r) => Number(r.getAttribute('x'))))].sort((a, b) => a - b);
      for (const r of el.querySelectorAll('rect.hm')) r.style.setProperty('--d', `${xs.indexOf(Number(r.getAttribute('x'))) * 22}ms`);
    }
  }
  if (el.matches(ROWS)) [...el.querySelectorAll('tbody tr')].forEach((tr, i) => tr.style.setProperty('--i', String(Math.min(i, 14))));
  el.classList.remove('fx-wait');
  el.classList.add('fx-play');
}

// ---------- 20 + 21. ink drop where you click; a soft light that follows the mouse over cards ----------
const INK_ON = '.btn, .t-btn, .chip, .res-tabs button, .sub-tabs button, .section-card, .test-row, .topic-card, .gate, .res-card, .topbar nav a';
const GLOW_ON = '.section-card, .test-row, .res-card';
const inkDrop = (e) => {
  if (!fxOn() || e.button > 0) return;
  const t = e.target instanceof Element && e.target.closest(INK_ON);
  if (!t || t.disabled) return;
  const d = document.createElement('span');
  d.className = 'ink-drop';
  d.setAttribute('aria-hidden', 'true');
  d.style.left = `${e.clientX}px`; d.style.top = `${e.clientY}px`;
  document.body.append(d);
  setTimeout(() => d.remove(), 700);
};
const glowMove = (e) => {
  if (!fxOn() || e.pointerType !== 'mouse') return;
  const card = e.target instanceof Element && e.target.closest(GLOW_ON);
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
  card.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
  card.classList.add('fx-glow');
};
let pointerOn = false;
function startPointerFx() {
  if (pointerOn) return; pointerOn = true;
  document.addEventListener('pointerdown', inkDrop, { passive: true });
  document.addEventListener('pointermove', glowMove, { passive: true });
}
function stopPointerFx() {
  pointerOn = false;
  document.removeEventListener('pointerdown', inkDrop);
  document.removeEventListener('pointermove', glowMove);
}

// ---------- 22. a gold line at the top shows how far down the page you have read ----------
let scrollLine = null;
const onScroll = () => {
  if (!scrollLine) return;
  const max = document.documentElement.scrollHeight - innerHeight;
  const k = max > 40 && !document.body.classList.contains('in-exam') ? Math.min(1, scrollY / max) : 0;
  scrollLine.style.transform = `scaleX(${k.toFixed(4)})`;
};
const onHash = () => setTimeout(onScroll, 50);
function startScrollLine() {
  if (scrollLine) return;
  scrollLine = document.createElement('div');
  scrollLine.className = 'scroll-line';
  scrollLine.setAttribute('aria-hidden', 'true');
  document.body.append(scrollLine);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('hashchange', onHash);
  onScroll();
}
function stopScrollLine() {
  removeEventListener('scroll', onScroll);
  removeEventListener('hashchange', onHash);
  if (scrollLine) scrollLine.remove();
  scrollLine = null;
}

// ---------- 23. embers drifting up behind the pages (not on the castle or in a dojo, which have their own) ----------
let embers = null;
function startEmbers() {
  if (embers || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'embers';
  c.setAttribute('aria-hidden', 'true');
  document.body.append(c);
  const g = c.getContext('2d');
  let W = 0; let H = 0;
  const size = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
  size();
  addEventListener('resize', size);
  const N = innerWidth < 700 ? 12 : 22;
  const P = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 1.8, v: 0.012 + Math.random() * 0.025, sway: Math.random() * 6.28, hue: 30 + Math.random() * 18 }));
  let last = performance.now(); let raf = 0; let idle = false;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const b = document.body.classList;
    if (document.hidden || b.contains('in-exam') || !b.contains('fx-on') || document.querySelector('.hero-scene, .dojo-ambience-wrap')) {
      if (!idle) { g.clearRect(0, 0, W, H); idle = true; }
      return;
    }
    idle = false;
    g.clearRect(0, 0, W, H);
    for (const p of P) {
      p.y -= p.v * dt; p.sway += dt * 0.7;
      if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      const x = (p.x + Math.sin(p.sway) * 0.012) * W; const y = p.y * H;
      const a = 0.35 + 0.35 * Math.sin(p.sway * 1.7);
      const grd = g.createRadialGradient(x, y, 0, x, y, p.r * 4);
      grd.addColorStop(0, `hsla(${p.hue}, 95%, 70%, ${a.toFixed(3)})`);
      grd.addColorStop(1, `hsla(${p.hue}, 95%, 55%, 0)`);
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, p.r * 4, 0, 6.283); g.fill();
    }
  };
  raf = requestAnimationFrame(frame);
  embers = { stop: () => { cancelAnimationFrame(raf); removeEventListener('resize', size); c.remove(); } };
}
function stopEmbers() { if (embers) embers.stop(); embers = null; }

/** Numbers inside `el` roll up from 0 to their value (text after the number is kept). */
function countUpIn(el) {
  const targets = [...(el.matches(COUNT) ? [el] : []), ...el.querySelectorAll(COUNT)];
  for (const t of targets) {
    if (t.dataset.counted) continue;
    t.dataset.counted = '1';
    const node = [...t.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
    if (!node) continue;
    const m = node.textContent.match(/^(\D*?)(-?\d+(?:\.\d+)?)(.*)$/s);
    if (!m) continue;
    const target = Number(m[2]);
    if (!Number.isFinite(target) || target === 0) continue;
    const decimals = (m[2].split('.')[1] || '').length;
    const t0 = performance.now(); const dur = Math.min(1100, 400 + Math.abs(target) * 6);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      node.textContent = `${m[1]}${(target * e).toFixed(decimals)}${m[3]}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// ---------- 15. phone vibration ----------
export function haptic(pattern) {
  try { if (fxOn() && navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ }
}

// ---------- 14. time of day ----------
/** 'dawn' 5-8, 'day' 8-17, 'dusk' 17-20, 'night' otherwise (this device's clock). */
export function dayPhase(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}
export function applyDayPhase() {
  document.body.dataset.phase = dayPhase();
}

// ---------- 13. start screen ----------
/** The oni badge with an ink ripple, under a second; once per opening of the app. */
export function startScreen() {
  try {
    if (sessionStorage.getItem('cpl.splashShown')) return;
    sessionStorage.setItem('cpl.splashShown', '1');
  } catch { return; }
  const el = document.createElement('div');
  el.className = 'start-screen';
  el.setAttribute('aria-hidden', 'true');
  const ripple = document.createElement('span'); ripple.className = 'ss-ripple';
  const ripple2 = document.createElement('span'); ripple2.className = 'ss-ripple r2';
  const img = document.createElement('img'); img.src = 'icon-512.png'; img.alt = ''; img.className = 'ss-badge';
  const name = document.createElement('p'); name.className = 'ss-name'; name.textContent = 'CAT Practice Lab';
  el.append(ripple, ripple2, img, name);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 800);
  setTimeout(() => el.remove(), 1250);
}
