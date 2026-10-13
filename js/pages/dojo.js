// Stage 6: the samurai game layer (6a: themed home screen). #/dojo = castle (home), #/dojo/<quant|varc|lrdi>
// = one dojo. Everything shown is calculated from saved attempts (game/progress.js); the only stored
// game choices are settings (CAT date, reduce effects), which the backup includes.
// The test screen itself is never themed.
import { h, fill, formatDate } from '../ui.js';
import { gameOnByDefault } from '../game/defaults.js';
import { listQuestions, listAllAttempts, listAllQuestionAttempts, listTests, listSources, getSetting, setSetting } from '../db.js';
import { gameState, DOJOS, POWER, MASTERY_ACCURACY, MASTERY_TESTS, BOSS_RETURN_DAYS, RANKS } from '../game/progress.js';
import { dojoEmblem, bossMask } from '../game/art.js';
import { radarChart, trendChart, speedBars, calendarHeatmap } from '../game/charts.js';
import { buildFeedback } from '../feedback.js';
import { heroScene } from '../game/scene.js';
import { playBattle } from '../game/battle.js';
import { dojoAmbience } from '../game/ambience.js';
import { celebrate, streakFlame } from '../game/rewards.js';
import { areaLabel, chapterLabel, areasOf } from '../topics.js';
import { formatDuration } from '../results.js';

/** Effects are on unless the user switched them off or the device asks for reduced motion. */
export async function effectsOn() {
  const reduce = await getSetting('game.reduceEffects', false);
  const motion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !reduce && !motion;
}

export async function render(root, params) {
  const enabled = await getSetting('game.enabled', gameOnByDefault());
  if (!enabled) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', null, 'Dojo'),
      h('div', { class: 'box' }, 'The samurai game is switched off. ', h('a', { href: '#/settings' }, 'Turn it on in Settings'), '.')));
    return null;
  }
  const [questions, attempts, records, tests, sources, catExamDate, fx] = await Promise.all([
    listQuestions(), listAllAttempts(), listAllQuestionAttempts(), listTests(), listSources(), getSetting('game.catExamDate', null), effectsOn()]);
  const now = Date.now();
  const g = gameState({ questions, attempts, records, tests, now, catExamDate });
  const srcName = new Map(sources.map((s) => [s.id, s.name]));
  const linkTo = (attemptId, questionId) => {
    const a = attempts.find((x) => x.id === attemptId);
    const i = a ? a.questions.findIndex((x) => x.questionId === questionId) : -1;
    return `#/result/${attemptId}?tab=solutions&q=${i + 1}`;
  };
  const dojo = DOJOS.find((d) => d.key === params.section);
  const page = h('div', { class: `game ${fx ? 'effects-on' : 'effects-off'}` });
  root.replaceChildren(page);
  if (params.section === 'progress') drawProgress(page, g, { questions, attempts, records, tests, sources, srcName, linkTo });
  else if (dojo) drawDojo(page, g, dojo, { srcName, linkTo, fx });
  else drawCastle(page, g, { fx, catExamDate });
  setTimeout(() => { if (page.isConnected) celebrate(g); }, 700);
  return { cleanup: () => page.dispatchEvent(new Event('game-cleanup')) };
}

const bar = (frac, cls = '') => h('div', { class: `g-bar ${cls}` }, h('div', { class: 'g-bar-fill', style: { width: `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%` } }));
const gradeBadge = (grade) => h('span', { class: `grade grade-${grade || 'none'}` }, grade || '—');
const plural = (n, w) => `${n} ${n === 1 ? w : w.endsWith('s') ? `${w}es` : `${w}s`}`;

/** Where the glow spots sit on the artwork (fractions of the sky / castle pictures). */
const GLOW = {
  moon: { x: 0.631, y: 0.257 },
  windows: [{ x: 0.332, y: 0.247 }, { x: 0.367, y: 0.329 }, { x: 0.405, y: 0.334 }, { x: 0.371, y: 0.423 }, { x: 0.591, y: 0.500 }, { x: 0.541, y: 0.517 }],
};
const ICON = (name) => `assets/theme/icons/${name}.webp`;
/** Page backdrop for CSS: a full address (a relative one would be read from the css/ folder). */
const backdrop = (name) => `url("${new URL(`assets/theme/${name}.webp`, document.baseURI).href}")`;
const RANK_ICON = ['rank1_ashigaru', 'rank2_samurai', 'rank3_hatamoto', 'rank4_daimyo', 'rank5_shogun'];
const DOJO_ICON = { quant: 'dojo_blade', varc: 'dojo_scroll', lrdi: 'dojo_shadow' };
const DOJO_ART = { quant: 'dojo_blade_header', varc: 'dojo_scroll_header', lrdi: 'dojo_shadow_header' };
const BADGE_ICON = { lantern: 'badge_torch', 'katana-crimson': 'badge_swords', crest: 'badge_shield', moon: 'badge_mountain', brush: 'badge_scroll', streak: 'badge_lightning', sakura: 'badge_sakura', hourglass: 'badge_hourglass' };
const pic = (src, cls, alt = '', eager = false) => h('img', { src, class: cls, alt, loading: eager ? 'eager' : 'lazy', decoding: 'async', draggable: false });
const plaque = (text) => h('div', { class: 'plaque' }, text);
const banner = (text) => h('h2', { class: 'section-banner' }, text);

function drawCastle(page, g, { fx, catExamDate }) {
  document.body.classList.add('dojo-page');
  page.addEventListener('game-cleanup', () => { document.body.classList.remove('dojo-page'); document.body.style.removeProperty('--page-backdrop'); scene.destroy(); }, { once: true });

  // ---- hero: the layered castle scene with the rank card ----
  const scene = heroScene({ fx, glow: GLOW });
  const rankCard = h('div', { class: 'rank-card' },
    h('div', { class: 'rank-text' },
      h('p', { class: 'kicker' }, 'Your rank'),
      h('h1', { id: 'rank-title' }, g.rank.name),
      h('p', { class: 'power', id: 'total-power' }, `${g.power} power`),
      bar(g.rank.progress, 'rank-bar'),
      h('p', { class: 'next' }, g.rank.next ? `${g.rank.toNext} more power to ${g.rank.next.name}` : 'The highest rank. The final boss awaits.'),
      streakFlame(g.streak)),
    pic(ICON(RANK_ICON[g.rank.index]), 'rank-emblem', `${g.rank.name} emblem`));
  const heroWrap = h('div', { class: 'hero-wrap' }, scene.el, rankCard);

  // ---- three dojo gates ----
  const gates = h('section', { class: 'gates' }, g.dojos.map((d) => h('a', { class: `gate gate-${d.key}`, href: `#/dojo/${d.key}`, id: `gate-${d.key}` },
    pic(`assets/theme/${DOJO_ART[d.key]}.webp`, 'gate-bg'),
    pic(ICON(DOJO_ICON[d.key]), 'medal', `${d.name} medallion`),
    pic(`assets/theme/${ENEMY_ART[d.key]}.webp`, 'gate-enemy', d.enemy, true),
    h('div', { class: 'gate-text' },
      h('p', { class: 'gate-way' }, d.way),
      h('p', { class: 'gate-name' }, d.name),
      h('p', { class: 'gate-subject-line' }, `${SUBJECT_LONG[d.subject] || d.subject}`),
      h('p', { class: 'gate-power' }, h('strong', null, String(d.power)), ' ', h('small', null, d.powerName)),
      h('p', { class: 'gate-stats' }, `${plural(d.battles, 'battle')} · ${plural(d.bossesDefeated, 'boss')} defeated · ${plural(d.scrollsOpen, 'Shadow Scroll')} open`)))));

  // ---- final boss (the daily quest, sakura tree and weekly boss cards were removed at the user's request) ----
  const dateIn = h('input', { type: 'date', id: 'cat-date', value: catExamDate || '' });
  dateIn.addEventListener('change', async () => { await setSetting('game.catExamDate', dateIn.value || null); location.reload(); });
  const fb = g.finalBoss;
  const final = h('section', { class: 'final-boss-panel', id: 'final-boss' },
    h('div', { class: 'fb-text' },
      h('p', { class: 'kicker' }, 'Final boss'),
      h('h2', { class: 't-title' }, 'The CAT'),
      fb.daysLeft == null ? h('p', null, 'Set your CAT exam date to see the countdown.')
        : h('p', { class: 'countdown' }, fb.daysLeft > 0 ? [h('strong', { class: 't-num' }, String(fb.daysLeft)), ` day${fb.daysLeft === 1 ? '' : 's'} left`] : fb.daysLeft === 0 ? 'Today is the day. Good luck!' : 'The exam date has passed.'),
      h('p', { class: 'small' }, 'Every battle you win sharpens the blade you bring to this one.'),
      h('label', { class: 'small fb-date' }, 'Exam date: ', dateIn)),
    pic('assets/theme/boss_final_sm.webp', 'fb-pic', 'The final boss, the Shogun on his throne', true));

  // ---- a short progress summary; the full statistics live on the Progress page (6d) ----
  const b = g.best;
  const summary = h('section', { class: 'washi progress-summary', id: 'progress-summary' },
    h('div', { class: 'ps-grid' },
      h('div', { class: 'ps-radar' }, radarChart(g.dojos.map((d) => ({ label: SUBJECT_SHORT[d.subject] || d.subject, value: d.power })))),
      h('div', { class: 'ps-facts' },
        h('h2', null, 'Your progress'),
        h('ul', { class: 'honour' },
          h('li', null, `${plural(g.battles.length, 'battle')} fought · ${b.sGrades} S grades`),
          h('li', null, `Best battle: ${b.accuracy ? `${b.accuracy.accuracy}% in "${b.accuracy.name}"` : '—'}`),
          h('li', null, `Longest streak: ${plural(b.streak, 'day')} · ${plural(g.days.count, 'practice day')}`),
          h('li', null, `Bosses defeated: ${b.bossesDefeated} · Shadow Scrolls cleared: ${b.scrollsCleared}`)),
        h('a', { class: 't-btn', href: '#/dojo/progress', id: 'open-progress' }, 'Progress, charts and the hall of badges ›'))));

  document.body.style.setProperty('--page-backdrop', backdrop('home_sky'));
  fill(page,
    heroWrap,
    h('div', { class: 'inner' },
    gates,
    final,
    summary,
    h('section', { class: 'washi how' }, h('h2', null, 'How the game counts'),
      h('ul', { class: 'small' },
        h('li', null, `Power: ${POWER.correct} per correct answer, ${POWER.scroll} per Shadow Scroll cleared, ${POWER.mastered} per topic boss defeated. Ranks: ${RANKS.map((r) => `${r.name} ${r.min}`).join(', ')}.`),
        h('li', null, 'Every submitted test is a battle: your score is the damage, your accuracy the grade (S 85%+, A 65%+, B below).'),
        h('li', null, `A sub-topic boss is defeated when you reach ${MASTERY_ACCURACY}% or better across your last ${MASTERY_TESTS} tests of it. If you leave it for ${BOSS_RETURN_DAYS} days it returns, a little stronger each week.`),
        h('li', null, 'Every question you got wrong becomes a Shadow Scroll. Answer it right in a later test, or re-try it right on its result page, to clear it.'),
        h('li', null, 'Nothing here is saved separately: it is all worked out from your test history, so a backup keeps it all.')),
      h('p', { class: 'small muted' }, h('a', { href: '#/credits' }, 'Credits: artwork and fonts')))));
}

const SUBJECT_SHORT = { 'Quantitative Aptitude': 'Quant', VARC: 'VARC', LRDI: 'LRDI' };
const SUBJECT_LONG = { 'Quantitative Aptitude': 'Quantitative Aptitude', VARC: 'Verbal Ability & Reading Comprehension', LRDI: 'Logical Reasoning & Data Interpretation' };
const ENEMY_ART = { quant: 'enemy_blade_oni', varc: 'enemy_scroll_spirit', lrdi: 'enemy_shadow_tengu' };
const MINIBOSS_ART = { quant: 'miniboss_blade', varc: 'miniboss_scroll', lrdi: 'miniboss_shadow' };
const MINIBOSS_NAME = { quant: 'the Iron General', varc: 'the Ink Sage', lrdi: 'the Shadow Fox' };

function drawDojo(page, g, dojo, { srcName, linkTo, fx }) {
  document.body.classList.add('dojo-page');
  page.classList.add(`dojo-${dojo.key}`);
  document.body.style.setProperty('--page-backdrop', backdrop(DOJO_ART[dojo.key]));
  let stopAmbience = null;
  page.addEventListener('game-cleanup', () => { document.body.classList.remove('dojo-page'); document.body.style.removeProperty('--page-backdrop'); if (stopAmbience) stopAmbience(); }, { once: true });
  const d = g.dojos.find((x) => x.key === dojo.key);
  const nodes = g.tree.filter((n) => n.subject === dojo.subject);
  const known = areasOf(dojo.subject);
  const areas = [...new Set([...known.filter((a) => nodes.some((n) => n.area === a)), ...nodes.map((n) => n.area).filter((a) => !known.includes(a))])];
  const scrolls = g.scrolls.filter((s) => s.subject === dojo.subject);
  const open = scrolls.filter((s) => !s.cleared);
  const STATE = { locked: 'Not fought yet', learning: 'In battle', mastered: 'Defeated', returned: 'Returned!' };
  const standing = nodes.filter((n) => n.state !== 'mastered');
  // the mini-boss of the dojo is the standing sub-topic boss with the most health (a choice of what to show, not a rule)
  const champion = standing.filter((n) => n.state !== 'locked').sort((a, b) => b.bossHp - a.bossHp)[0] || null;

  // ---- header scene ----
  const head = h('section', { class: 'dojo-scene' },
    pic(`assets/theme/${DOJO_ART[dojo.key]}.webp`, 'dojo-scene-bg', '', true),
    h('div', { class: 'dojo-scene-shade' }),
    fx ? h('div', { class: 'dojo-ambience-wrap', id: 'dojo-ambience' }) : null,
    h('div', { class: 'dojo-scene-title' },
      pic(ICON(DOJO_ICON[dojo.key]), 'dojo-medal', `${dojo.name} medallion`, true),
      h('div', null, h('p', { class: 'kicker' }, dojo.way), h('h1', { class: 't-title' }, dojo.name),
        h('p', { class: 'dojo-sub' }, h('strong', { class: 't-num' }, String(d.power)), ` ${dojo.powerName} · ${plural(d.battles, 'battle')} · ${plural(d.bossesDefeated, 'boss')} defeated`))),
    h('a', { class: 'dojo-back', href: '#/dojo' }, '‹ Castle'));

  // ---- power, enemy, mini-boss ----
  const power = h('div', { class: 'washi framed', id: 'dojo-power' },
    plaque(dojo.powerName),
    h('p', { class: 'big t-num' }, String(d.power)),
    h('p', { class: 'small' }, `${d.correct} correct × ${POWER.correct} + ${d.scrollsCleared} scrolls cleared × ${POWER.scroll} + ${d.mastered} bosses defeated × ${POWER.mastered}`),
    h('a', { class: 't-btn', href: `#/sectional/new?subject=${dojo.key}` }, 'Train: make a sectional test'));
  const enemy = h('div', { class: 'washi framed enemy-card' },
    plaque(dojo.enemy),
    pic(`assets/theme/${ENEMY_ART[dojo.key]}.webp`, 'enemy-pic', `${dojo.enemy}`, true),
    h('p', null, `${plural(standing.length, 'boss')} still standing, ${d.bossesDefeated} defeated` + (d.bossesReturned ? `, ${d.bossesReturned} returned` : '') + '.'),
    h('p', { class: 'small muted' }, `${plural(open.length, 'Shadow Scroll')} open in this dojo.`));
  const mini = h('div', { class: 'washi framed miniboss-card' },
    plaque(`Mini-boss: ${MINIBOSS_NAME[dojo.key]}`),
    pic(`assets/theme/${MINIBOSS_ART[dojo.key]}.webp`, 'miniboss-pic' + (champion ? '' : ' defeated'), MINIBOSS_NAME[dojo.key], true),
    champion
      ? [h('p', null, 'Guards ', h('strong', null, chapterLabel(champion.chapter)), ` (${areaLabel(champion.area)}) — ${STATE[champion.state]}`),
        h('div', { class: 'hp' }, bar(champion.bossHp / 100, 'hp-bar'), h('span', { class: 'small t-num' }, `${champion.bossHp}% HP`)),
        h('p', { class: 'small muted' }, `Reach ${MASTERY_ACCURACY}% across your last ${MASTERY_TESTS} tests of this sub-topic to defeat it.`)]
      : h('p', null, nodes.length ? 'All the bosses you have met here are defeated. New sub-topics will bring new ones.' : 'Add a DPP of this subject to meet the first boss.'));

  // ---- skill tree: one node per sub-topic, lit by accuracy; a red seal when mastered ----
  const nodeEl = (n) => {
    const lit = n.state === 'locked' ? 0 : Math.max(8, n.progress);
    const ring = h('div', { class: 'node-ring', style: { '--lit': `${lit}%` } },
      h('div', { class: `node-portrait ${n.state === 'returned' ? 'portrait-miniboss' : 'portrait-enemy'}`, role: 'img', 'aria-label': n.state === 'mastered' ? 'Defeated — sealed' : dojo.enemy }),
      n.state === 'mastered' ? pic(ICON('seal_red'), 'node-seal', '') : null);
    const ratio = n.testsCount ? `${plural(n.testsCount, 'test')}, last ${MASTERY_TESTS}: ${n.accuracy}%` : `${plural(n.questions, 'question')} waiting`;
    return h('div', { class: `node node-${n.state}`, dataset: { chapter: n.chapter }, title: `${chapterLabel(n.chapter)}: ${STATE[n.state]}` },
      ring,
      h('div', { class: 'node-body' },
        h('strong', { class: 'node-name' }, chapterLabel(n.chapter)),
        h('span', { class: 'small node-state' }, ` ${STATE[n.state]}`),
        h('div', { class: 'hp', title: `Boss health ${n.bossHp}%` }, bar(n.bossHp / 100, 'hp-bar'), h('span', { class: 'small t-num' }, `${n.bossHp}% HP`)),
        h('span', { class: 'small muted' }, ratio + (n.state === 'returned' ? ` · ${n.idleDays} days since practice` : ''))));
  };
  const tree = areas.length
    ? h('div', { class: 'skill-tree', id: 'skill-tree' }, areas.map((a) => h('div', { class: 'branch' },
      h('h3', { class: 't-title branch-title' }, areaLabel(a)),
      nodes.filter((n) => n.area === a).sort((x, y) => x.chapter.localeCompare(y.chapter)).map(nodeEl))))
    : h('p', { class: 'muted' }, `No ${dojo.subject} questions yet. Add a DPP to open this dojo.`);

  const scrollList = scrolls.length
    ? h('ul', { class: 'scrolls', id: 'shadow-scrolls' }, [...open, ...scrolls.filter((s) => s.cleared).slice(0, 10)].map((s) => h('li', { class: s.cleared ? 'cleared' : 'open' },
      h('span', null, `${srcName.get(s.sourceId) || 'PDF'}, Q${s.n}`), h('span', { class: 'small muted' }, ` · ${chapterLabel(s.chapter)}`),
      s.cleared ? h('span', { class: 'small ok' }, ` · cleared (${s.clearedHow === 'retry' ? 're-try' : 'in a test'})`)
        : [' · ', h('a', { href: linkTo(s.attemptId, s.questionId) }, 'Face it'), h('span', { class: 'small muted' }, ' (turn on "Reattempt questions" there)')])))
    : h('p', { class: 'muted' }, 'No Shadow Scrolls: no wrong answers yet in this dojo.');
  const battles = g.battles.filter((b) => b.subject === dojo.subject).slice(-10).reverse();
  if (fx) stopAmbience = dojoAmbience(head.querySelector('#dojo-ambience'), dojo.key);
  fill(page,
    head,
    h('div', { class: 'inner' },
    h('section', { class: 't-grid three' }, power, enemy, mini),
    banner('Skill tree — one boss per sub-topic'),
    h('section', { class: 'washi' }, tree,
      h('p', { class: 'small muted tree-legend' }, 'The ring around each boss fills with your accuracy; at mastery the boss is sealed in red. A sealed boss returns if the sub-topic is left for weeks.')),
    h('section', { class: 't-grid two' },
      h('div', { class: 'washi' }, h('h2', null, `Shadow Scrolls (${open.length} open)`), scrollList),
      h('div', { class: 'washi' }, h('h2', null, 'Recent battles'), battles.length
        ? h('ul', { class: 'battles' }, battles.map((b) => h('li', null, gradeBadge(b.grade), ` ${b.name} · ${b.damage} damage · ${b.accuracy ?? '—'}% `, h('a', { href: `#/result/${b.attemptId}` }, 'Result'))))
        : h('p', { class: 'muted' }, 'No battles in this dojo yet.')))));
}

/** Battle data for one attempt, plus the game state before and after it (for rank-ups and badges). */
function battleFor(attemptId, { questions, attempts, records, tests }) {
  const after = gameState({ questions, attempts, records, tests });
  const b = after.battles.find((x) => x.attemptId === attemptId);
  if (!b) return null;
  const before = gameState({ questions, attempts: attempts.filter((a) => a.id !== attemptId), records: records.filter((r) => r.attemptId !== attemptId), tests });
  const dojo = DOJOS.find((x) => x.subject === b.subject) || DOJOS[0];
  return { battle: b, dojo, before, after };
}

/** Play the battle scene for a submitted attempt (results page only). Resolves when closed. */
export async function playBattleFor(attemptId, data) {
  if (!(await getSetting('game.enabled', gameOnByDefault()))) return;
  const info = battleFor(attemptId, data);
  if (!info) return;
  const fx = await effectsOn();
  if (fx && (info.battle.grade === 'S' || info.battle.grade === 'A') && typeof navigator.vibrate === 'function') navigator.vibrate(80);
  await playBattle({ ...info, fx });
}

/** Victory banner for the results page (only when the game is on). */
export async function victoryBanner(attemptId, data) {
  if (!(await getSetting('game.enabled', gameOnByDefault()))) return null;
  const info = battleFor(attemptId, data);
  if (!info) return null;
  const { battle: b, dojo: d } = info;
  return h('div', { class: `victory victory-${b.grade}`, id: 'victory' },
    h('span', { class: 'grade-big' }, b.grade || '—'),
    h('span', { class: 'victory-text' }, h('strong', null, b.grade === 'S' ? 'Flawless victory!' : b.grade === 'A' ? 'Victory!' : 'Battle fought.'),
      ` ${b.damage} damage to the ${d.enemy} · accuracy ${b.accuracy ?? '—'}% `),
    h('button', { type: 'button', class: 't-btn', id: 'replay-battle', onClick: () => playBattleFor(attemptId, data) }, 'Replay battle'),
    h('a', { class: 't-btn', href: '#/dojo' }, 'Castle'));
}

/** 6d: Progress page — charts, trends, bests, battle log, hall of badges, mistake traps. */
const CAL_WEEKS = 20;
/** The numbers beside the practice calendar, from the same per-day counts the calendar shows. */
function calendarStats(g) {
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - ((since.getDay() + 6) % 7) - (CAL_WEEKS - 1) * 7);
  const key = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  const inWindow = [...g.days.answeredPerDay.entries()].filter(([day, n]) => day >= key && n > 0);
  const answered = inWindow.reduce((s, [, n]) => s + n, 0);
  const best = inWindow.slice().sort((a, b) => b[1] - a[1])[0] || null;
  const stat = (v, k, sub) => h('div', { class: 'cal-stat' }, h('strong', { class: 't-num' }, v), h('span', null, k), sub ? h('span', { class: 'cal-sub' }, sub) : null);
  return h('div', { class: 'cal-stats' },
    stat(String(inWindow.length), 'practice days', `of the last ${CAL_WEEKS * 7}`),
    stat(String(answered), 'questions answered', inWindow.length ? `${Math.round(answered / inWindow.length)} per practice day` : 'in these weeks'),
    stat(plural(g.streak?.count || 0, 'day'), 'current streak', 'one rest day a week allowed'),
    stat(plural(g.streak?.best || 0, 'day'), 'best streak', best ? `best day: ${best[1]} on ${formatDate(`${best[0]}T12:00:00`).replace(/,.*$/, '')}` : 'no practice day yet'));
}

function drawProgress(page, g, { questions, attempts, records, tests, sources, srcName, linkTo }) {
  document.body.classList.add('dojo-page');
  document.body.style.setProperty('--page-backdrop', backdrop('home_sky'));
  page.addEventListener('game-cleanup', () => { document.body.classList.remove('dojo-page'); document.body.style.removeProperty('--page-backdrop'); }, { once: true });
  const fb = buildFeedback({ questions, attempts, records, sources, tests });
  const b = g.best;

  // accuracy trend per dojo (one line each) and per sub-topic (top 5 by number of answers)
  const perDojo = g.dojos.map((d) => ({ label: SUBJECT_SHORT[d.subject] || d.subject, points: g.battles.filter((x) => x.subject === d.subject && x.accuracy != null).map((x) => ({ at: x.at, accuracy: x.accuracy, name: x.name })) }));
  const topGroups = fb.groups.filter((x) => x.points.length >= 2).sort((x, y) => y.answered - x.answered).slice(0, 5);
  const perTopic = topGroups.map((x) => ({ label: x.short, points: x.points.map((p) => ({ at: p.at, accuracy: p.accuracy, name: p.testName })) }));
  const legend = (series) => h('ul', { class: 'legend' }, series.map((x, i) => h('li', null, h('span', { class: `swatch s${i}` }), x.label)));

  const speed = speedBars(g.dojos.map((d) => ({ label: SUBJECT_SHORT[d.subject] || d.subject, value: d.avgMs, target: d.targetMs, text: `${d.avgMs == null ? '—' : formatDuration(d.avgMs)} / ${formatDuration(d.targetMs)}` })));
  const bests = h('div', { class: 'bests' }, [
    ['Best battle', b.accuracy ? `${b.accuracy.accuracy}%` : '—', b.accuracy ? b.accuracy.name : '10+ answered questions needed'],
    ['Longest streak', plural(b.streak, 'day'), 'with one rest day a week'],
    ['Most in one day', String(b.dayQuestions), 'questions answered'],
    ['S grades', String(b.sGrades), '85% accuracy or better'],
    ['Bosses defeated', String(b.bossesDefeated), 'sub-topics mastered'],
    ['Scrolls cleared', String(b.scrollsCleared), 'mistakes put right'],
  ].map(([k, v, sub]) => h('div', { class: 'best' }, h('span', { class: 'best-k' }, k), h('strong', { class: 'best-v t-num' }, v), h('span', { class: 'best-s' }, sub))));

  const log = g.battles.slice().reverse();
  const battleLog = log.length
    ? h('table', { class: 'g-table', id: 'battle-log' }, h('thead', null, h('tr', null, ['Date', 'Test', 'Subject', 'Grade', 'Damage', 'Accuracy', ''].map((t) => h('th', null, t)))),
      h('tbody', null, log.slice(0, 30).map((x) => h('tr', null, h('td', null, formatDate(new Date(x.at).toISOString()).replace(/,.*$/, '')), h('td', null, x.name),
        h('td', null, SUBJECT_SHORT[x.subject] || x.subject), h('td', null, gradeBadge(x.grade)), h('td', null, String(x.damage)), h('td', null, x.accuracy == null ? '—' : `${x.accuracy}%`),
        h('td', null, h('a', { href: `#/result/${x.attemptId}` }, 'Result'))))))
    : h('p', { class: 'muted' }, 'No battles yet. Every submitted test is a battle.');

  const badges = h('div', { class: 'badge-hall', id: 'badge-hall' }, g.unlocks.map((u) => {
    const icon = u.kind === 'title' ? ICON(RANK_ICON[RANKS.findIndex((r) => r.name === u.name)]) : BADGE_ICON[u.id] ? ICON(BADGE_ICON[u.id]) : null;
    return h('div', { class: `hall-badge ${u.unlocked ? 'unlocked' : 'locked'}`, title: u.how },
      icon ? pic(icon, 'hall-icon', '') : null,
      h('strong', null, u.name), h('span', { class: 'small muted' }, u.unlocked ? (u.kind === 'title' ? 'Title earned' : 'Earned') : u.how));
  }));

  // common mistake traps: tagged reasons, repeated wrongs, fast-but-wrong, right-but-slow (from Feedback)
  const trapList = (list, cols) => (list.length
    ? h('table', { class: 'g-table' }, h('thead', null, h('tr', null, cols.head.map((t) => h('th', null, t)))), h('tbody', null, list.slice(0, 8).map((r) => h('tr', null, cols.row(r).map((c) => h('td', null, c))))))
    : h('p', { class: 'muted small' }, 'None yet.'));
  const traps = h('div', { class: 'traps' },
    h('div', null, h('h3', null, 'Why you say it went wrong'), fb.reasons.length
      ? h('ul', { class: 'honour' }, fb.reasons.map((r) => h('li', null, h('strong', null, r.label), ` × ${r.count}`, r.groups.length ? h('span', { class: 'small muted' }, ` — ${r.groups.slice(0, 3).join(', ')}`) : '')))
      : h('p', { class: 'muted small' }, 'No mistake reasons tagged yet (Solutions → Q. Analysis on a result page).')),
    h('div', null, h('h3', null, `Wrong more than once (${fb.repeated.length})`), trapList(fb.repeated, { head: ['Question', 'Sub-topic', 'Wrong', ''], row: (r) => [r.ref, r.short, `${r.wrongCount}×`, h('a', { href: linkTo(r.lastAttemptId, r.questionId) }, 'Solution')] })),
    h('div', null, h('h3', null, `Rushed and wrong — under 1 min (${fb.fastWrong.length})`), trapList(fb.fastWrong, { head: ['Question', 'Sub-topic', 'Time', ''], row: (r) => [r.ref, r.short, formatDuration(r.timeMs), h('a', { href: linkTo(r.attemptId, r.questionId) }, 'Solution')] })),
    h('div', null, h('h3', null, `Right but slow — over 3 min (${fb.slowCorrect.length})`), trapList(fb.slowCorrect, { head: ['Question', 'Sub-topic', 'Time', ''], row: (r) => [r.ref, r.short, formatDuration(r.timeMs), h('a', { href: linkTo(r.attemptId, r.questionId) }, 'Solution')] })));

  fill(page,
    h('section', { class: 'progress-head inner' },
      h('p', null, h('a', { href: '#/dojo', class: 'dojo-back static' }, '‹ Castle')),
      h('h1', { class: 't-title' }, 'Progress'),
      h('p', { class: 'muted' }, 'Everything here is worked out from your saved tests. Statistics with more detail: ', h('a', { href: '#/feedback' }, 'Feedback'), '.')),
    h('div', { class: 'inner' },
      h('section', { class: 't-grid two' },
        h('div', { class: 'washi framed radar-panel' }, plaque('Your three powers'), radarChart(g.dojos.map((d) => ({ label: SUBJECT_SHORT[d.subject] || d.subject, value: d.power }))),
          h('p', { class: 'small muted' }, `${g.dojos.map((d) => `${SUBJECT_SHORT[d.subject] || d.subject} = ${d.way.replace('Way of the ', '')}`).join(' · ')}. Power: ${POWER.correct} per correct answer, ${POWER.scroll} per Shadow Scroll cleared, ${POWER.mastered} per boss defeated.`)),
        h('div', { class: 'washi framed speed-panel' }, plaque('Speed against CAT pace'), speed,
          h('p', { class: 'small muted' }, 'Bar = your average time per answered question across all your tests; the dashed line = CAT pace (40 minutes per section). Red = slower than the pace.'))),
      banner('Accuracy over time'),
      h('section', { class: 't-grid two' },
        h('div', { class: 'washi' }, h('h2', null, 'Per subject, every test'), trendChart(perDojo), legend(perDojo)),
        h('div', { class: 'washi' }, h('h2', null, 'Per sub-topic (your 5 most practised)'), perTopic.length ? [trendChart(perTopic), legend(perTopic)] : h('p', { class: 'muted' }, 'Appears after two tests of the same sub-topic.'))),
      h('section', { class: 'washi calendar-panel' }, h('h2', null, 'Practice calendar'),
        h('div', { class: 'cal-grid' }, calendarHeatmap(g.days.answeredPerDay, Date.now(), CAL_WEEKS), calendarStats(g)),
        h('p', { class: 'small muted' }, `Last ${CAL_WEEKS} weeks, one square per day. Darker = more questions answered that day; today has a dark edge.`)),
      banner('Personal bests'),
      h('section', { class: 'washi framed' }, bests),
      banner('Hall of badges'),
      h('section', { class: 'washi' }, badges),
      banner('Common traps'),
      h('section', { class: 'washi' }, traps),
      banner('Battle log'),
      h('section', { class: 'washi' }, battleLog)));
}
