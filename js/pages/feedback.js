// Stage 4: #/feedback — what to practise next, from ALL submitted tests (rule-based, no AI), and
// the "Copy mistake report" button. The analysis itself is in ../feedback.js.
import { h, fill, formatDate } from '../ui.js';
import { listQuestions, listAllAttempts, listAllQuestionAttempts, listSources, listTests } from '../db.js';
import { buildFeedback, mistakeReport, WEAK_ACCURACY, STRONG_ACCURACY, MIN_ANSWERED } from '../feedback.js';
import { formatDuration } from '../results.js';
import { mockTrend } from '../mock-stats.js';
import { mockTrendView } from '../mock-charts.js';

const SUBJECTS = [
  { key: 'all', subject: null, title: 'All subjects' },
  { key: 'quant', subject: 'Quantitative Aptitude', title: 'Quant' },
  { key: 'varc', subject: 'VARC', title: 'VARC' },
  { key: 'lrdi', subject: 'LRDI', title: 'LRDI' },
];
const LEVEL = { weak: 'Weak', ok: 'OK', strong: 'Strong', unknown: `Too few (< ${MIN_ANSWERED})` };
const ARROW = { up: '▲', down: '▼', steady: '▬' };

export async function render(root, params) {
  const [questions, attempts, records, sources, tests] = await Promise.all([listQuestions(), listAllAttempts(), listAllQuestionAttempts(), listSources(), listTests()]);
  let sel = SUBJECTS.find((s) => s.key === params.subject) || SUBJECTS[0];
  const page = h('div', { class: 'page feedback' });
  root.replaceChildren(page);

  const linkTo = (attemptId, questionId) => {
    const a = attempts.find((x) => x.id === attemptId);
    const i = a ? a.questions.findIndex((x) => x.questionId === questionId) : -1;
    return `#/result/${attemptId}?tab=solutions&q=${i + 1}`;
  };

  function draw() {
    const fb = buildFeedback({ questions, attempts, records, sources, tests, subject: sel.subject });
    const t = fb.totals;
    const reportText = () => mistakeReport(fb, { dateText: formatDate(new Date().toISOString()).replace(/,.*$/, ''), subjectText: sel.title.toLowerCase() });
    const copyStatus = h('span', { class: 'small', role: 'status', id: 'copy-status' });
    const fallback = h('div', { id: 'report-fallback' });
    const copy = async () => {
      const text = reportText();
      try {
        await navigator.clipboard.writeText(text);
        copyStatus.className = 'ok small';
        copyStatus.textContent = 'Copied. Paste it into any AI chat.';
        fill(fallback);
      } catch {
        copyStatus.className = 'error small';
        copyStatus.textContent = 'This browser did not allow copying. Select the text below and copy it, or download it.';
        showText(text);
      }
    };
    const showText = (text) => fill(fallback,
      h('textarea', { class: 'report-text', readonly: true, rows: 12, id: 'report-text' }, text),
      h('p', null, h('button', { type: 'button', class: 'btn btn-small', onClick: () => download(text) }, 'Download as a text file')));

    fill(page,
      h('div', { class: 'page-head' },
        h('h1', null, 'Feedback'),
        h('div', { class: 'test-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', id: 'copy-report', disabled: !t.answered, onClick: copy }, 'Copy mistake report'),
          h('button', { type: 'button', class: 'btn', id: 'show-report', disabled: !t.answered, onClick: () => showText(reportText()) }, 'Show report'))),
      h('p', { class: 'muted small' }, 'Worked out from all your submitted tests (DPP, sectional and mock), counting only real answers. No AI is used. ',
        'The report is plain text you can paste into any AI chat.'),
      copyStatus, fallback,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Subject' }, SUBJECTS.map((s) =>
        h('button', { type: 'button', class: 'chip' + (s === sel ? ' on' : ''), id: `fb-${s.key}`, onClick: () => {
          sel = s;
          history.replaceState(null, '', '#/feedback' + (s.key === 'all' ? '' : `?subject=${s.key}`));
          draw();
        } }, s.title))),
      h('section', { class: 'card', id: 'advice' },
        h('h2', null, 'What to practise next'),
        h('ol', { class: 'advice' }, fb.recommendations.map((r) => h('li', { class: `advice-${r.kind}` },
          h('strong', null, r.title), h('br'), h('span', null, r.because),
          r.action?.type === 'sectional' ? [' ', h('a', { href: `#/sectional/new?subject=${keyOf(r.action.subject)}` }, 'Make a sectional test')] : null,
          r.action?.type === 'weak' ? [' ', h('a', { href: '#/sectional' }, 'Practise weak questions')] : null,
          r.action?.type === 'mocks' ? [' ', h('a', { href: '#/library/mock' }, 'Go to your mocks')] : null)))),
      t.answered ? details(fb) : null,
      mocks.length ? h('details', { class: 'res-fold', open: true, id: 'fb-mocks' }, h('summary', null, `Mock tests (${mocks.length})`),
        h('p', { class: 'muted small' }, 'Every submitted mock, section by section. Open a mock to see its charts and tag its questions.'), mockTrendView(mocks)) : null);
  }
  const mocks = mockTrend(attempts, new Map(questions.map((q) => [q.id, q])));

  function details(fb) {
    const t = fb.totals;
    const card = (title, value, sub) => h('div', { class: 'res-card', id: `fb-card-${title.toLowerCase().replace(/\s+/g, '-')}` }, h('div', { class: 'res-card-title' }, title), h('div', { class: 'res-card-value' }, value), h('div', { class: 'muted small' }, sub));
    const table = (head, rows, cls = '') => h('table', { class: `res-table ${cls}` }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));
    const fold = (title, body, open = true, id = null) => h('details', { class: 'res-fold', open, id }, h('summary', null, title), body);
    const qList = (list, cols) => list.length
      ? table(cols.head, list.slice(0, 50).map(cols.row))
      : h('p', { class: 'muted' }, 'None.');
    return h('div', null,
      h('div', { class: 'res-cards', id: 'fb-totals' },
        card('Tests', String(t.attempts), 'submitted'),
        card('Answered', String(t.answered), `${t.correct} correct · ${t.wrong} wrong`),
        card('Accuracy', t.accuracy == null ? '—' : `${t.accuracy}%`, 'of answered questions'),
        card('Marks lost', String(-t.negative), 'to wrong answers'),
        card('Skipped', String(t.skipped), 'opened, not answered')),
      fold('Accuracy by sub-topic', h('div', null,
        h('p', { class: 'muted small' }, `Weak = under ${WEAK_ACCURACY}%, strong = ${STRONG_ACCURACY}% or more, judged after ${MIN_ANSWERED} answered questions. Trend = earlier tests vs later tests.`),
        table(['Sub-topic', 'Answered', 'Correct', 'Accuracy', 'Avg time', 'Marks lost', 'Trend', 'Level'],
          fb.groups.map((g) => [g.label, g.answered, g.correct, g.accuracy == null ? '—' : `${g.accuracy}%`, formatDuration(g.avgTimeMs),
            g.negative < 0 ? String(-g.negative) : '0',
            h('span', { class: 'trend' }, spark(g.points), g.trend ? h('span', { class: `trend-${g.trend.direction}`, title: `${g.trend.before}% → ${g.trend.after}%` }, ` ${ARROW[g.trend.direction]} ${g.trend.change > 0 ? '+' : ''}${g.trend.change}`) : ''),
            h('span', { class: `level level-${g.level}` }, LEVEL[g.level])]), 'fb-groups')), true, 'fb-subtopics'),
      fold('Accuracy by topic', table(['Topic', 'Answered', 'Correct', 'Accuracy', 'Avg time', 'Marks lost'],
        fb.areas.map((a) => [a.label, a.answered, a.correct, a.accuracy == null ? '—' : `${a.accuracy}%`, formatDuration(a.avgTimeMs), String(-a.negative)])), false),
      fold(`Wrong more than once (${fb.repeated.length})`, qList(fb.repeated, {
        head: ['Question', 'Sub-topic', 'Wrong', 'Your answers', 'Correct', 'Last time', ''],
        row: (r) => [r.ref, r.short, `${r.wrongCount} of ${r.timesSeen}`, r.answers.join(', '), r.key, r.lastResult === 'correct' ? 'right' : r.lastResult,
          h('a', { href: linkTo(r.lastAttemptId, r.questionId) }, 'Solution')],
      }), true, 'fb-repeated'),
      fold(`Fast but wrong — under 1 minute (${fb.fastWrong.length})`, qList(fb.fastWrong, {
        head: ['Question', 'Sub-topic', 'Time', 'Test', ''],
        row: (r) => [r.ref, r.short, formatDuration(r.timeMs), r.testName, h('a', { href: linkTo(r.attemptId, r.questionId) }, 'Solution')],
      }), false, 'fb-fast'),
      fold(`Right but slow — over 3 minutes (${fb.slowCorrect.length})`, qList(fb.slowCorrect, {
        head: ['Question', 'Sub-topic', 'Time', 'Test', ''],
        row: (r) => [r.ref, r.short, formatDuration(r.timeMs), r.testName, h('a', { href: linkTo(r.attemptId, r.questionId) }, 'Solution')],
      }), false, 'fb-slow'),
      fold('Your mistake reasons', fb.reasons.length
        ? table(['Reason', 'Times', 'Sub-topics'], fb.reasons.map((r) => [r.label, r.count, r.groups.join(', ')]))
        : h('p', { class: 'muted' }, 'None tagged yet. On a result page, open Solutions → Q. Analysis to tag why a question went wrong.'), false));
  }

  draw();
  return null;
}

const keyOf = (subject) => (subject === 'VARC' ? 'varc' : subject === 'LRDI' ? 'lrdi' : 'quant');

/** Tiny accuracy-per-test line (SVG, no library). */
function spark(points) {
  if (points.length < 2) return '';
  const w = 70;
  const hgt = 20;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(hgt - (p.accuracy / 100) * hgt).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `-2 -2 ${w + 4} ${hgt + 4}`);
  svg.setAttribute('width', String(w + 4));
  svg.setAttribute('height', String(hgt + 4));
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-label', `Accuracy per test: ${points.map((p) => `${p.accuracy}%`).join(', ')}`);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function download(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cat-mistake-report-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
