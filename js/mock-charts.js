// Stage 7c: charts for full mock tests (plain HTML bars and one SVG line chart, no library).
// They only draw numbers computed in mock-stats.js.
import { h } from './ui.js';
import { formatDuration } from './results.js';

const pctText = (v) => (v == null ? '—' : `${v}%`);
const width = (v) => `${Math.max(0, Math.min(100, v || 0))}%`;

/** Attempt rate vs accuracy, two bars per section. */
export function attemptAccuracyChart(sections) {
  return h('div', { class: 'mock-bars', id: 'chart-attempt-accuracy', role: 'img', 'aria-label': sections.map((s) => `${s.name}: attempted ${pctText(s.attemptRate)}, accuracy ${pctText(s.accuracy)}`).join('; ') },
    sections.map((s) => h('div', { class: 'mb-row' },
      h('div', { class: 'mb-name' }, s.name),
      h('div', { class: 'mb-bars' },
        bar('Attempted', s.attemptRate, 'attempt', `${s.attempted} of ${s.questions}`),
        bar('Accuracy', s.accuracy, s.accuracy == null ? 'none' : s.accuracy >= 80 ? 'good' : s.accuracy >= 60 ? 'ok' : 'low', s.attempted ? `${s.correct} of ${s.attempted} right` : 'nothing attempted')))),
    h('p', { class: 'muted small mb-note' }, 'Attempted = share of the section\'s questions you answered. Accuracy = share of those answers that were right.'));
}

function bar(label, value, cls, note) {
  return h('div', { class: 'mb-bar' },
    h('span', { class: 'mb-label' }, label),
    h('span', { class: 'mb-track' }, h('span', { class: `mb-fill ${cls}`, style: { width: width(value) } })),
    h('span', { class: 'mb-value' }, pctText(value), h('span', { class: 'muted small' }, ` · ${note}`)));
}

/**
 * Where each section's clock went: time on questions you got right / wrong / left unanswered,
 * time between questions (reading, moving around), and time left over when you submitted early.
 */
export function timeSplitChart(sections) {
  const parts = (s) => {
    const on = s.timeOn.correct + s.timeOn.incorrect + s.timeOn.skipped;
    const other = Math.max(0, s.usedMs - on);
    return [
      ['correct', 'On right answers', s.timeOn.correct],
      ['incorrect', 'On wrong answers', s.timeOn.incorrect],
      ['skipped', 'On questions left unanswered', s.timeOn.skipped],
      ['other', 'Between questions', other],
      ['unused', 'Not used (submitted early)', s.unusedMs],
    ];
  };
  return h('div', { class: 'mock-time', id: 'chart-time-split' },
    sections.map((s) => h('div', { class: 'mt-row' },
      h('div', { class: 'mt-head' },
        h('strong', null, s.name),
        h('span', { class: 'muted small' }, `used ${formatDuration(s.usedMs)} of ${formatDuration(s.allottedMs)}` + (s.endedBy === 'time' ? ' · time ran out' : s.endedBy === 'you' ? ' · you submitted' : ''))),
      h('div', { class: 'mt-track', role: 'img', 'aria-label': `${s.name}: ` + parts(s).filter((p) => p[2] > 0).map((p) => `${p[1]} ${formatDuration(p[2])}`).join(', ') },
        parts(s).filter((p) => p[2] > 0).map(([cls, label, ms]) => h('span', { class: `mt-seg ${cls}`, style: { width: `${(ms / s.allottedMs) * 100}%` }, title: `${label}: ${formatDuration(ms)}` }))))),
    h('div', { class: 'mt-legend' },
      [['correct', 'On right answers'], ['incorrect', 'On wrong answers'], ['skipped', 'On unanswered questions'], ['other', 'Between questions'], ['unused', 'Not used']]
        .map(([cls, label]) => h('span', null, h('i', { class: `mt-seg ${cls}` }), label))));
}

/**
 * Trend across mocks: one line per section (score as a share of that section's maximum, so
 * sections of different sizes compare), plus the numbers in a table.
 */
export function mockTrendView(trend) {
  if (!trend.length) return h('p', { class: 'muted' }, 'No mock submitted yet.');
  const names = [...new Set(trend.flatMap((t) => t.sections.map((s) => s.name)))];
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const date = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const table = h('table', { class: 'res-table mock-trend-table', id: 'mock-trend-table' },
    h('thead', null, h('tr', null, h('th', null, 'Mock'), h('th', null, 'Date'), names.map((n) => h('th', null, n)), h('th', null, 'Total'))),
    h('tbody', null, trend.map((t) => h('tr', null,
      h('td', null, h('a', { href: `#/result/${t.attemptId}` }, t.name)), h('td', null, date(t.at)),
      names.map((n) => { const s = t.sections.find((x) => x.name === n); return h('td', null, s ? `${fmt(s.score)} / ${fmt(s.maxScore)}` : '—', s ? h('div', { class: 'muted small' }, `${pctText(s.attemptRate)} att. · ${pctText(s.accuracy)} acc.`) : null); }),
      h('td', null, h('strong', null, `${fmt(t.total.score)} / ${fmt(t.total.maxScore)}`))))));
  return h('div', { class: 'mock-trend' }, trend.length >= 2 ? lineChart(trend, names) : h('p', { class: 'muted small' }, 'The trend line appears after your second mock.'), table);
}

function lineChart(trend, names) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, text = null) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text != null) e.textContent = text; return e; };
  const W = 640; const H = 220; const L = 40; const R = 14; const T = 12; const B = 28;
  const w = W - L - R; const hh = H - T - B;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mock-line', role: 'img', 'aria-label': 'Score per section across your mocks, as a share of the section maximum' });
  for (const v of [0, 25, 50, 75, 100]) {
    const y = T + hh - (v / 100) * hh;
    svg.append(el('line', { x1: L, y1: y, x2: L + w, y2: y, class: v === 0 ? 'axis' : 'grid' }));
    svg.append(el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' }, `${v}%`));
  }
  const x = (i) => (trend.length < 2 ? L + w / 2 : L + (i / (trend.length - 1)) * w);
  names.forEach((n, si) => {
    const pts = trend.map((t, i) => { const s = t.sections.find((z) => z.name === n); return s && s.maxScore ? [x(i), T + hh - (Math.max(0, s.score) / s.maxScore) * hh, s, t] : null; }).filter(Boolean);
    if (!pts.length) return;
    svg.append(el('polyline', { points: pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), class: `ml s${si}` }));
    for (const [px, py, s, t] of pts) { const c = el('circle', { cx: px, cy: py, r: 4, class: `md s${si}` }); c.append(el('title', {}, `${n} · ${t.name}: ${s.score} / ${s.maxScore}`)); svg.append(c); }
  });
  trend.forEach((t, i) => svg.append(el('text', { x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === trend.length - 1 ? 'end' : 'middle', class: 'tick' }, `#${i + 1}`)));
  const legend = h('div', { class: 'mt-legend' }, names.map((n, si) => h('span', null, h('i', { class: `ml-sw s${si}` }), n)));
  return h('div', { class: 'mock-line-wrap' }, svg, legend, h('p', { class: 'muted small' }, 'Score in each section as a share of that section\'s maximum (negative scores shown at 0). #1 = your first mock.'));
}
