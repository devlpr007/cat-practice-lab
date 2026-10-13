// Stage 6c: the battle scene shown AFTER a test (never during it). Pure presentation of numbers
// the game already computed from the saved attempt: damage = the test score, the enemy's health
// after the battle = 1 - score / max score, the hero's focus bar = accuracy, grade S/A/B, and any
// rank-up or badge that this battle unlocked (state before vs after the attempt). One tap skips.
import { h } from '../ui.js';
import { sfx } from './sound.js';

const ASSETS = 'assets/theme/';
const DOJO_ART = { quant: 'dojo_blade_header', varc: 'dojo_scroll_header', lrdi: 'dojo_shadow_header' };
const ENEMY_ART = { quant: 'enemy_blade_oni', varc: 'enemy_scroll_spirit', lrdi: 'enemy_shadow_tengu' };
const RANK_ICON = ['rank1_ashigaru', 'rank2_samurai', 'rank3_hatamoto', 'rank4_daimyo', 'rank5_shogun'];
const BADGE_ICON = { lantern: 'badge_torch', 'katana-crimson': 'badge_swords', crest: 'badge_shield', moon: 'badge_mountain', brush: 'badge_scroll' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * battle: { name, subject, damage, score, maxScore, accuracy, grade, correct, wrong, questions }
 * dojo: { key, name, enemy, powerName }; before / after: { rank, unlocks, power } from gameState.
 * fx: false = no animation, the final state is shown at once. Returns a Promise resolved on close.
 */
export function playBattle({ battle, dojo, before, after, fx, onContinue }) {
  const won = battle.grade === 'S' || battle.grade === 'A';
  const enemyHp = battle.maxScore > 0 ? Math.max(0, 1 - Math.max(0, battle.score) / battle.maxScore) : 1;
  const focus = (battle.accuracy ?? 0) / 100;
  const rankUp = after.rank.index > before.rank.index ? after.rank : null;
  const newBadges = after.unlocks.filter((u) => u.unlocked && !before.unlocks.find((b) => b.id === u.id)?.unlocked && u.kind !== 'title');

  const hero = h('img', { src: `${ASSETS}samurai_idle.webp`, class: 'b-hero', alt: 'You, the samurai', draggable: false });
  const strike = h('img', { src: `${ASSETS}samurai_strike.webp`, class: 'b-hero b-strike', alt: '', draggable: false, 'aria-hidden': 'true', hidden: true });
  const enemy = h('img', { src: `${ASSETS}${ENEMY_ART[dojo.key]}.webp`, class: 'b-enemy', alt: dojo.enemy, draggable: false });
  const enemyBar = h('div', { class: 'b-bar b-bar-enemy' }, h('div', { class: 'b-bar-fill', style: { width: '100%' } }));
  const heroBar = h('div', { class: 'b-bar b-bar-hero' }, h('div', { class: 'b-bar-fill', style: { width: '0%' } }));
  const damage = h('div', { class: 'b-damage', 'aria-live': 'polite' });
  const caption = h('p', { class: 'b-caption', id: 'battle-caption', 'aria-live': 'polite' }, `${dojo.enemy} block your way. Draw your blade.`);
  const skip = h('button', { type: 'button', class: 'b-skip', id: 'battle-skip' }, 'Skip ›');
  const finale = h('div', { class: 'b-finale', id: 'battle-finale', hidden: true });
  const fxTimeline = [];

  const el = h('div', { class: `battle-overlay ${fx ? 'fx' : 'no-fx'} b-${dojo.key}`, id: 'battle-overlay', role: 'dialog', 'aria-label': 'Battle result' },
    h('img', { src: `${ASSETS}${DOJO_ART[dojo.key]}.webp`, class: 'b-bg', alt: '', draggable: false }),
    h('div', { class: 'b-shade' }),
    h('div', { class: 'b-flash', 'aria-hidden': 'true' }),
    h('div', { class: 'b-stage' },
      h('div', { class: 'b-side b-side-hero' }, hero, strike,
        h('div', { class: 'b-plate' }, h('span', { class: 'b-name' }, 'You'), h('span', { class: 'b-sub' }, 'Focus (accuracy)'), heroBar)),
      h('div', { class: 'b-side b-side-enemy' }, enemy, damage,
        h('div', { class: 'b-plate' }, h('span', { class: 'b-name' }, dojo.enemy), h('span', { class: 'b-sub' }, battle.name), enemyBar)),
      h('span', { class: 'b-slash', 'aria-hidden': 'true' })),
    caption, finale, skip);
  document.body.append(el);
  document.body.classList.add('battle-open');

  let skipped = false;
  let resolveClose;
  const closed = new Promise((r) => { resolveClose = r; });
  const close = () => { window.removeEventListener('hashchange', close); el.remove(); document.body.classList.remove('battle-open'); resolveClose(); };
  window.addEventListener('hashchange', close); // leaving the results page closes the battle
  const step = (ms) => (skipped || !fx ? Promise.resolve() : wait(ms));
  const doSkip = () => { skipped = true; el.classList.add('skipping'); };
  skip.addEventListener('click', (e) => { e.stopPropagation(); if (finale.hidden) doSkip(); else close(); });
  el.addEventListener('click', (e) => { if (finale.hidden && !e.target.closest('.b-finale')) doSkip(); });

  const showFinal = () => {
    enemyBar.firstChild.style.width = `${(enemyHp * 100).toFixed(1)}%`;
    heroBar.firstChild.style.width = `${(focus * 100).toFixed(1)}%`;
    damage.textContent = `−${battle.damage}`;
    damage.classList.add('show');
    if (won) enemy.classList.add('defeated');
    hero.hidden = false; strike.hidden = true;
    caption.textContent = won
      ? `${dojo.enemy} ${battle.grade === 'S' ? 'fall without a sound. Flawless.' : 'are driven back. Victory.'}`
      : `${dojo.enemy} withstand the blow. The battle goes on.`;
    const fills = [];
    fills.push(h('div', { class: `b-grade grade-${battle.grade || 'none'}` }, battle.grade || '—'));
    fills.push(h('div', { class: 'b-numbers' },
      h('div', null, h('strong', { class: 't-num', id: 'battle-damage' }, String(battle.damage)), h('span', null, ' damage')),
      h('div', null, h('strong', { class: 't-num' }, `${battle.accuracy ?? '—'}%`), h('span', null, ' accuracy')),
      h('div', null, h('strong', { class: 't-num' }, `${battle.correct}/${battle.correct + battle.wrong}`), h('span', null, ' right of answered'))));
    if (rankUp) fills.push(h('div', { class: 'b-rankup', id: 'battle-rankup' },
      h('img', { src: `${ASSETS}icons/${RANK_ICON[rankUp.index]}.webp`, alt: '', class: 'b-rank-icon' }),
      h('div', null, h('span', { class: 'kicker' }, 'Rank up'), h('strong', { class: 't-title' }, rankUp.name))));
    if (newBadges.length) fills.push(h('div', { class: 'b-loot', id: 'battle-loot' },
      h('span', { class: 'kicker' }, newBadges.length === 1 ? 'Badge earned' : 'Badges earned'),
      h('div', { class: 'b-badges' }, newBadges.map((u) => h('div', { class: 'b-badge' },
        BADGE_ICON[u.id] ? h('img', { src: `${ASSETS}icons/${BADGE_ICON[u.id]}.webp`, alt: '' }) : null, h('span', null, u.name))))));
    fills.push(h('button', { type: 'button', class: 't-btn b-continue', id: 'battle-continue', onClick: () => { close(); onContinue?.(); } }, 'See the results ›'));
    finale.replaceChildren(...fills);
    finale.hidden = false;
    skip.textContent = 'Close ✕';
  };

  (async () => {
    await step(2200);                                   // face-off
    if (!skipped && fx) { hero.hidden = true; strike.hidden = false; el.classList.add('slashing'); sfx.slash(); }
    await step(650);                                    // the slash lands
    if (!skipped && fx) {
      el.classList.add('hit');
      sfx.hit();
      enemyBar.firstChild.style.width = `${(enemyHp * 100).toFixed(1)}%`;
      heroBar.firstChild.style.width = `${(focus * 100).toFixed(1)}%`;
      damage.textContent = `−${battle.damage}`;
      damage.classList.add('show');
      caption.textContent = `A clean strike: ${battle.damage} damage.`;
    }
    await step(1500);
    if (!skipped && fx) { hero.hidden = false; strike.hidden = true; if (won) enemy.classList.add('defeated'); }
    await step(won ? 1300 : 500);
    showFinal();
    if (fx && !skipped) { if (rankUp) { el.classList.add('ceremony'); sfx.gong(); } else sfx.chime(); }
  })();
  return closed;
}
