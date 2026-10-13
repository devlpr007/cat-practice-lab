// Premium touches (user's list, 2026-10-14): brush-stroke page changes, cards that unroll into
// view, numbers that count up, phone vibration, time of day, start screen. (The 3D tilt and the new
// sounds were removed at the user's request the same day.)
// All of it runs only when the game's effects are on (body.fx-on: game on, "Reduce effects" off,
// no reduce-motion), never on the test screen (body.in-exam). Pure presentation.

export const fxOn = () => document.body.classList.contains('fx-on') && !document.body.classList.contains('in-exam');

/** Turn the effects class on or off (main.js, Settings). */
export function setFx(on) {
  document.body.classList.toggle('fx-on', !!on);
  if (on) startEnhancer(); else stopEnhancer();
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
      setTimeout(() => { el.classList.add('in'); if (el.matches(COUNT) || el.querySelector(COUNT)) countUpIn(el); }, delay);
    }
  }, { threshold: 0.08 });
  const take = (node) => {
    if (!(node instanceof Element) || !fxOn()) return;
    const els = [...(node.matches(REVEAL) ? [node] : []), ...node.querySelectorAll(REVEAL)];
    for (const el of els) {
      if (el.dataset.fxSeen) continue;
      el.dataset.fxSeen = '1';
      if (el.closest('.exam, dialog, .battle-overlay')) continue;
      el.classList.add('reveal');
      io.observe(el);
      // safety: whatever happens, a card is never left hidden
      setTimeout(() => { if (!el.classList.contains('in')) el.classList.add('in'); }, 1500);
    }
  };
  mo = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) take(n); });
  const root = document.getElementById('app');
  mo.observe(root, { childList: true, subtree: true });
  take(root);
}
function stopEnhancer() {
  if (mo) mo.disconnect(); if (io) io.disconnect();
  mo = null; io = null;
  for (const el of document.querySelectorAll('.reveal')) el.classList.add('in');
}

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
