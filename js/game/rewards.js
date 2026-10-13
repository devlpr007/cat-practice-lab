// Reward moments (user's list, 2026-10-14): rank-up ceremony, boss-defeat cut-in, streak flame,
// the red seal stamp on a result. Shown only for real changes computed from saved attempts (the
// game state); each ceremony is shown once per device (settings "game.rankShown" /
// "game.bossesShown", device-only). The first time this runs on a device it only remembers the
// current state, so nothing old is replayed. Never on the test screen.
import { h } from '../ui.js';
import { getSetting, setSetting } from '../db.js';
import { fxOn, haptic } from './live.js';
import { DOJOS } from './progress.js';

const ICON = (name) => `assets/theme/icons/${name}.webp`;
const RANK_ICON = ['rank1_ashigaru', 'rank2_samurai', 'rank3_hatamoto', 'rank4_daimyo', 'rank5_shogun'];
const MINIBOSS_ART = { 'Quantitative Aptitude': 'miniboss_blade', VARC: 'miniboss_scroll', LRDI: 'miniboss_shadow' };

/** Show any rank-up and newly defeated bosses since the last visit. g = gameState(). */
export async function celebrate(g) {
  if (document.body.classList.contains('in-exam')) return;
  const rankShown = await getSetting('game.rankShown', null);
  const shownBosses = await getSetting('game.bossesShown', null);
  const defeated = g.tree.filter((n) => n.state === 'mastered').map((n) => n.key);
  if (rankShown === null || shownBosses === null) {
    // first run on this device: remember, do not replay the past
    await setSetting('game.rankShown', g.rank.index);
    await setSetting('game.bossesShown', defeated);
    return;
  }
  const newBosses = g.tree.filter((n) => n.state === 'mastered' && !shownBosses.includes(n.key));
  if (g.rank.index > rankShown) {
    await setSetting('game.rankShown', g.rank.index);
    await rankCeremony(g.rank);
  } else if (g.rank.index < rankShown) await setSetting('game.rankShown', g.rank.index);
  for (const n of newBosses.slice(0, 3)) await bossCutIn(n);
  if (newBosses.length) await setSetting('game.bossesShown', defeated);
}

function overlay(cls, children, ms) {
  return new Promise((resolve) => {
    const el = h('div', { class: `ceremony ${cls}`, role: 'dialog', 'aria-live': 'polite', tabindex: '-1' }, ...children,
      h('p', { class: 'cer-tap small' }, 'Tap to continue'));
    const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 350); window.removeEventListener('hashchange', close); };
    el.addEventListener('click', close);
    window.addEventListener('hashchange', close);
    document.body.append(el);
    el.focus();
    if (ms) setTimeout(() => { if (el.isConnected) close(); }, ms);
  });
}

/** 6: rank-up — the emblem rises with a burst of petals. */
async function rankCeremony(rank) {
  const fx = fxOn();
  const petals = h('canvas', { class: 'cer-petals', 'aria-hidden': 'true' });
  const p = overlay('rank-up' + (fx ? ' fx' : ''), [
    petals,
    h('img', { src: ICON(RANK_ICON[rank.index]), class: 'cer-emblem', alt: '' }),
    h('p', { class: 'cer-kicker' }, 'New rank'),
    h('h2', { class: 'cer-title', id: 'rank-up-title' }, `You are now ${/^[AEIOU]/.test(rank.name) ? 'an' : 'a'} ${rank.name}`),
  ], 6500);
  haptic([40, 60, 120]);
  if (fx) petalBurst(petals);
  return p;
}

/** 7: a sub-topic boss defeated — its mask cracks and shatters into ink, a red "Defeated" seal. */
async function bossCutIn(node) {
  const art = MINIBOSS_ART[node.subject] || 'miniboss_blade';
  const p = overlay('boss-down' + (fxOn() ? ' fx' : ''), [
    h('div', { class: 'cer-boss' },
      h('img', { src: `assets/theme/${art}.webp`, class: 'cer-boss-art', alt: '' }),
      h('span', { class: 'cer-crack', 'aria-hidden': 'true' }),
      h('span', { class: 'cer-seal', 'aria-hidden': 'true' }, '討')),
    h('p', { class: 'cer-kicker' }, 'Boss defeated'),
    h('h2', { class: 'cer-title' }, node.chapter || 'A sub-topic'),
    h('p', { class: 'cer-sub small' }, `${DOJOS.find((d) => d.subject === node.subject)?.name || ''} · mastered: ${node.accuracy}% in your last tests`),
  ], 4500);
  setTimeout(() => haptic([30, 40, 30]), 450);
  return p;
}

function petalBurst(canvas) {
  const W = canvas.width = innerWidth; const H = canvas.height = innerHeight;
  const g = canvas.getContext('2d');
  const P = Array.from({ length: 70 }, () => ({ x: W / 2, y: H * 0.42, vx: (Math.random() - 0.5) * 700, vy: -Math.random() * 600 - 150, r: 4 + Math.random() * 6, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 8, hue: 335 + Math.random() * 18 }));
  let last = performance.now(); const t0 = last;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.clearRect(0, 0, W, H);
    for (const p of P) {
      p.vy += 520 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.max(0, 1 - (now - t0) / 3500);
      g.fillStyle = `hsl(${p.hue} 80% 84%)`; g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    if (now - t0 < 3600 && canvas.isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** 8: the streak flame (grows with the days) and the rest-day lantern. */
export function streakFlame(streak) {
  const n = streak?.count || 0;
  const size = n === 0 ? 0 : Math.min(1, 0.35 + n / 20);
  return h('div', { class: 'streak-flame', id: 'streak-flame', title: `${n} day streak` + (streak?.restUsedThisWeek ? ' · rest day used this week' : '') },
    h('span', { class: `flame${n ? '' : ' out'}`, style: { '--size': size.toFixed(2) }, 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('span', { class: 'streak-text' }, h('strong', { class: 't-num' }, String(n)), ` day${n === 1 ? '' : 's'} streak`),
    streak?.restUsedThisWeek ? h('img', { class: 'rest-lantern', src: ICON('badge_torch'), alt: 'Rest day used this week', title: 'Rest day used this week' }) : null);
}

/** 9: the red seal stamp with the grade (S / A / B) for a result. */
export function gradeStamp(grade, { animate }) {
  if (!grade) return null;
  const el = h('div', { class: `grade-stamp g-${grade}${animate ? ' stamping' : ''}`, id: 'grade-stamp', role: 'img', 'aria-label': `Grade ${grade}` },
    h('span', { class: 'gs-letter' }, grade), h('span', { class: 'gs-word' }, grade === 'S' ? 'Flawless' : grade === 'A' ? 'Victory' : 'Fought'));
  if (animate) {
    setTimeout(() => haptic(25), 380);
  }
  return el;
}
