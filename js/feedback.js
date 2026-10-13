// Stage 4: built-in feedback across ALL submitted tests (pure code, unit-testable in Node, no AI).
// Everything here is counted from saved data: per-question records of submitted attempts, the
// questions' topic / sub-topic, and the user's own mistake reasons. Advice sentences only quote
// these numbers; when there is too little data the app says so instead of guessing.
import { SLOW_MS } from './results.js';
import { MISTAKE_REASONS } from './model.js';
import { areaLabel, chapterLabel } from './topics.js';
import { isUntaggedMock, UNTAGGED_LABEL } from './mock-stats.js';

/** A sub-topic is judged only after this many answered questions in it. */
export const MIN_ANSWERED = 4;
/** Accuracy (%) below which a sub-topic counts as weak. */
export const WEAK_ACCURACY = 60;
/** Accuracy (%) at or above which a sub-topic counts as strong. */
export const STRONG_ACCURACY = 80;
/** A wrong answer given in less than this is "fast but wrong". */
export const FAST_MS = 60_000;
/** Change in accuracy (percentage points) between the earlier and later half that counts as a trend. */
export const TREND_POINTS = 15;
/** Too little data overall below this many answered questions. */
export const MIN_TOTAL_ANSWERED = 10;

const SUBJECT_SHORT = { 'Quantitative Aptitude': 'Quant', VARC: 'VARC', LRDI: 'LRDI' };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const round2 = (x) => Math.round(x * 100) / 100;

/** What one record says: 'correct' | 'wrong' | 'skipped' (opened, no answer) | 'unseen' | null (not scored). */
export function resultOf(r) {
  if (r.correct === true) return 'correct';
  if (r.correct === false) return 'wrong';
  if (r.answer == null) return r.visits > 0 ? 'skipped' : 'unseen';
  return null;
}

/**
 * Join records with their attempt and question. Only submitted attempts and questions still in the
 * library count. Optional subject filter. Returns rows sorted by submit time.
 */
export function feedbackRows({ questions, attempts, records, sources = [], tests = [], subject = null }) {
  const qById = new Map(questions.map((q) => [q.id, q]));
  const aById = new Map(attempts.filter((a) => a.status === 'submitted').map((a) => [a.id, a]));
  const srcName = new Map(sources.map((s) => [s.id, s.name]));
  const testById = new Map(tests.map((t) => [t.id, t]));
  const rows = [];
  for (const r of records) {
    const a = aById.get(r.attemptId);
    const q = qById.get(r.questionId);
    if (!a || !q) continue;
    if (subject && q.subject !== subject) continue;
    const result = resultOf(r);
    if (!result) continue;
    rows.push({
      record: r, q, attempt: a, at: a.submittedAt, result,
      marks: typeof r.marks === 'number' ? r.marks : 0,
      timeMs: r.timeSpentMs || 0,
      testName: a.snapshot?.name || testById.get(a.testId)?.name || 'Test',
      testKind: testById.get(a.testId)?.kind || 'pdf',
      ref: `${srcName.get(q.sourceId) || 'PDF'}, Q${q.n}`,
      group: `${q.subject}|${q.area || ''}|${q.chapter || ''}`,
      reason: r.mistakeReason?.code || null,
    });
  }
  rows.sort((x, y) => x.at - y.at);
  return rows;
}

function stats(list) {
  const answered = list.filter((r) => r.result === 'correct' || r.result === 'wrong');
  const correct = answered.filter((r) => r.result === 'correct').length;
  const wrong = answered.length - correct;
  return {
    answered: answered.length,
    correct,
    wrong,
    skipped: list.filter((r) => r.result === 'skipped').length,
    accuracy: pct(correct, answered.length),
    negative: round2(list.filter((r) => r.marks < 0).reduce((s, r) => s + r.marks, 0)),
    marks: round2(list.reduce((s, r) => s + r.marks, 0)),
    avgTimeMs: answered.length ? Math.round(answered.reduce((s, r) => s + r.timeMs, 0) / answered.length) : null,
    slowCorrect: answered.filter((r) => r.result === 'correct' && r.timeMs > SLOW_MS).length,
    fastWrong: answered.filter((r) => r.result === 'wrong' && r.timeMs < FAST_MS).length,
    tests: new Set(list.map((r) => r.attempt.id)).size,
  };
}

/**
 * Earlier tests vs later tests (tests in time order, split in two halves; with an odd number the
 * middle test is left out). Each half needs MIN_ANSWERED answered questions; null otherwise.
 */
export function trendOf(list) {
  const answered = list.filter((r) => r.result === 'correct' || r.result === 'wrong');
  const order = [...new Set(answered.map((r) => r.attempt.id))];
  if (order.length < 2) return null;
  const half = Math.floor(order.length / 2);
  const earlyIds = new Set(order.slice(0, half));
  const lateIds = new Set(order.slice(order.length - half));
  const early = answered.filter((r) => earlyIds.has(r.attempt.id));
  const late = answered.filter((r) => lateIds.has(r.attempt.id));
  if (early.length < MIN_ANSWERED || late.length < MIN_ANSWERED) return null;
  const acc = (l) => pct(l.filter((r) => r.result === 'correct').length, l.length);
  const before = acc(early);
  const after = acc(late);
  const change = Math.round((after - before) * 10) / 10;
  return { before, after, change, direction: change >= TREND_POINTS ? 'up' : change <= -TREND_POINTS ? 'down' : 'steady' };
}

/** Accuracy per test for one group, in time order (for the small trend chart). */
function pointsOf(list) {
  const byAttempt = new Map();
  for (const r of list) {
    if (r.result !== 'correct' && r.result !== 'wrong') continue;
    const p = byAttempt.get(r.attempt.id) || { at: r.at, testName: r.testName, answered: 0, correct: 0 };
    p.answered++;
    if (r.result === 'correct') p.correct++;
    byAttempt.set(r.attempt.id, p);
  }
  return [...byAttempt.values()].sort((a, b) => a.at - b.at).map((p) => ({ ...p, accuracy: pct(p.correct, p.answered) }));
}

const nameOf = (q) => (isUntaggedMock(q)
  ? { subject: q.subject, area: q.area || '', chapter: q.chapter || '', label: `${SUBJECT_SHORT[q.subject] || q.subject} › ${UNTAGGED_LABEL}`, short: UNTAGGED_LABEL, untagged: true }
  : {
    subject: q.subject, area: q.area || '', chapter: q.chapter || '',
    label: `${SUBJECT_SHORT[q.subject] || q.subject} › ${areaLabel(q.area)} › ${chapterLabel(q.chapter)}`,
    short: chapterLabel(q.chapter),
  });

/**
 * The whole analysis. Returns { totals, groups, areas, repeated, slowCorrect, fastWrong,
 * reasons, recommendations, enough }.
 */
export function buildFeedback(input) {
  const rows = feedbackRows(input);
  const totals = stats(rows);
  totals.attempts = new Set(rows.map((r) => r.attempt.id)).size;
  const enough = totals.answered >= MIN_TOTAL_ANSWERED;

  // per sub-topic and per topic
  const byGroup = new Map();
  for (const r of rows) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  const groups = [...byGroup.entries()].map(([key, list]) => {
    const s = stats(list);
    const judged = s.answered >= MIN_ANSWERED && !isUntaggedMock(list[0].q);
    return {
      key, ...nameOf(list[0].q), ...s, judged,
      level: !judged ? 'unknown' : s.accuracy < WEAK_ACCURACY ? 'weak' : s.accuracy >= STRONG_ACCURACY ? 'strong' : 'ok',
      trend: isUntaggedMock(list[0].q) ? null : trendOf(list), points: pointsOf(list),
    };
  }).sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || b.answered - a.answered);
  const byArea = new Map();
  for (const r of rows) {
    const k = `${r.q.subject}|${r.q.area || ''}`;
    if (!byArea.has(k)) byArea.set(k, []);
    byArea.get(k).push(r);
  }
  const areas = [...byArea.entries()].map(([key, list]) => ({
    key, subject: list[0].q.subject, area: list[0].q.area || '',
    label: `${SUBJECT_SHORT[list[0].q.subject] || list[0].q.subject} › ${areaLabel(list[0].q.area)}`, ...stats(list),
  })).sort((a, b) => a.label.localeCompare(b.label));

  // the same question wrong in more than one test
  const byQuestion = new Map();
  for (const r of rows) {
    if (!byQuestion.has(r.q.id)) byQuestion.set(r.q.id, []);
    byQuestion.get(r.q.id).push(r);
  }
  const repeated = [];
  for (const list of byQuestion.values()) {
    const wrong = list.filter((r) => r.result === 'wrong');
    if (wrong.length < 2) continue;
    const last = list[list.length - 1];
    repeated.push({
      questionId: list[0].q.id, ref: list[0].ref, ...nameOf(list[0].q),
      wrongCount: wrong.length, timesSeen: list.length, answers: wrong.map((r) => r.record.answer), key: list[0].q.answer,
      lastResult: last.result, lastAttemptId: last.attempt.id,
    });
  }
  repeated.sort((a, b) => b.wrongCount - a.wrongCount || (a.lastResult === 'correct') - (b.lastResult === 'correct'));

  const answeredRows = rows.filter((r) => r.result === 'correct' || r.result === 'wrong');
  const listRow = (r) => ({ questionId: r.q.id, ref: r.ref, ...nameOf(r.q), timeMs: r.timeMs, attemptId: r.attempt.id, testName: r.testName, at: r.at, given: r.record.answer, key: r.q.answer });
  const slowCorrect = answeredRows.filter((r) => r.result === 'correct' && r.timeMs > SLOW_MS).map(listRow).reverse();
  const fastWrong = answeredRows.filter((r) => r.result === 'wrong' && r.timeMs < FAST_MS).map(listRow).reverse();

  // mistake reasons the user tagged
  const reasons = MISTAKE_REASONS.map((m) => {
    const tagged = rows.filter((r) => r.reason === m.code);
    return { code: m.code, label: m.label, count: tagged.length, groups: [...new Set(tagged.map((r) => nameOf(r.q).short))] };
  }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);

  return {
    totals, enough, groups, areas, repeated, slowCorrect, fastWrong, reasons,
    recommendations: recommend({ totals, enough, groups, repeated, slowCorrect, fastWrong, reasons }),
  };
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const most = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0] || null;
};

/** Plain-language advice, most important first. Each item: { kind, title, because, action? }. */
export function recommend({ totals, enough, groups, repeated, slowCorrect, fastWrong, reasons }) {
  const out = [];
  if (!totals.answered) {
    return [{ kind: 'start', title: 'Take a test first', because: 'There are no submitted tests yet, so there is nothing to analyse.' }];
  }
  if (!enough) {
    out.push({ kind: 'more-data', title: 'Take a few more tests', because: `So far ${plural(totals.answered, 'question')} answered. The advice below gets more reliable after at least ${MIN_TOTAL_ANSWERED}.` });
  }
  const weak = groups.filter((g) => g.level === 'weak').slice(0, 3);
  for (const g of weak) {
    out.push({
      kind: 'weak', group: g.key, title: `Practise ${g.short} (${areaLabel(g.area)}) next`,
      because: `You got ${g.correct} of ${g.answered} right (${g.accuracy}%) over ${plural(g.tests, 'test')}` + (g.negative < 0 ? ` and lost ${-g.negative} marks to wrong answers there.` : '.'),
      action: { type: 'sectional', subject: g.subject, mode: 'new' },
    });
  }
  for (const g of groups.filter((x) => x.trend?.direction === 'down').slice(0, 2)) {
    out.push({ kind: 'declining', group: g.key, title: `${g.short} is slipping`, because: `Accuracy fell from ${g.trend.before}% in your earlier tests to ${g.trend.after}% in the later ones.` });
  }
  if (repeated.length) {
    const open = repeated.filter((x) => x.lastResult !== 'correct').length;
    out.push({
      kind: 'repeated', title: `Redo the ${plural(repeated.length, 'question')} you got wrong more than once`,
      because: `${plural(repeated.length, 'question')} were answered wrong in two or more tests` + (open ? `; ${open} of them are still wrong the last time you saw them.` : '.'),
      action: { type: 'weak' },
    });
  }
  const neg = -totals.negative;
  if (neg >= 3) {
    const worst = groups.filter((g) => g.negative < 0).sort((a, b) => a.negative - b.negative)[0];
    out.push({
      kind: 'negative', title: 'Cut negative marks',
      because: `Wrong MCQ answers cost you ${neg} marks in total` + (worst ? `, the most in ${worst.short} (${-worst.negative}).` : '.') + ' When you cannot rule out options, skipping costs 0.',
    });
  }
  if (fastWrong.length >= 3) {
    const top = most(fastWrong, 'short');
    out.push({ kind: 'fast-wrong', title: 'Slow down on questions you rush', because: `${plural(fastWrong.length, 'wrong answer')} took under 1 minute` + (top ? ` (most in ${top[0]}: ${top[1]}).` : '.') + ' Re-read the question and check units before answering.' });
  }
  if (slowCorrect.length >= 3) {
    const top = most(slowCorrect, 'short');
    out.push({ kind: 'slow-correct', title: 'Build speed where you are right but slow', because: `${plural(slowCorrect.length, 'correct answer')} took over 3 minutes` + (top ? ` (most in ${top[0]}: ${top[1]}).` : '.') + ' Practise these with a timer.' });
  }
  const skippedGroup = groups.filter((g) => g.skipped >= 3).sort((a, b) => b.skipped - a.skipped)[0];
  if (skippedGroup) {
    out.push({ kind: 'skipped', group: skippedGroup.key, title: `Look at the questions you skip in ${skippedGroup.short}`, because: `You opened and left ${skippedGroup.skipped} questions unanswered there. Read their solutions and try them again.` });
  }
  for (const r of reasons.filter((x) => x.count >= 3).slice(0, 2)) {
    const where = r.groups.length ? ` (in ${r.groups.slice(0, 3).join(', ')})` : '';
    const tip = { careless: 'Check each answer once before moving on.', concept: 'Revise the basics of these sub-topics before more tests.', misread: 'Underline what the question asks for.', time: 'Practise with a timer and leave very long questions for later.', trap: 'Note the trap in your tag so you spot it next time.', other: '' }[r.code] || '';
    out.push({ kind: 'reason', title: `"${r.label}" is your most tagged mistake reason`, because: `You tagged it ${plural(r.count, 'time')}${where}. ${tip}`.trim() });
  }
  const improving = groups.filter((g) => g.trend?.direction === 'up').slice(0, 1);
  for (const g of improving) out.push({ kind: 'improving', group: g.key, title: `${g.short} is improving`, because: `Accuracy rose from ${g.trend.before}% in your earlier tests to ${g.trend.after}% in the later ones. Keep it up.` });
  const strong = groups.filter((g) => g.level === 'strong').slice(-2);
  if (strong.length && enough) out.push({ kind: 'strong', title: `Strong: ${strong.map((g) => g.short).join(', ')}`, because: strong.map((g) => `${g.short} ${g.accuracy}% (${g.correct}/${g.answered})`).join('; ') + '. Keep these fresh with a mixed sectional test now and then.' });
  const untagged = groups.filter((g) => g.untagged).reduce((s, g) => s + g.answered + g.skipped, 0);
  if (untagged) {
    out.push({ kind: 'tag-mocks', title: 'Tag your mock questions', because: `${plural(untagged, 'mock question')} you answered or opened ${untagged === 1 ? 'has' : 'have'} no topic yet, so ${untagged === 1 ? 'it is' : 'they are'} left out of the topic advice above. Tag them on the mock's result page (Analysis → Tag mock questions).`, action: { type: 'mocks' } });
  }
  if (out.length === (enough ? 0 : 1) + (untagged ? 1 : 0)) out.push({ kind: 'none', title: 'No clear weak spot yet', because: `Overall accuracy is ${totals.accuracy}% over ${plural(totals.answered, 'answered question')}.` });
  return out;
}

const fmtTime = (ms) => {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The "Copy mistake report" text (plain text, ready to paste into any AI chat). */
export function mistakeReport(fb, { dateText, subjectText = 'all subjects' } = {}) {
  const L = [];
  L.push(`CAT Practice Lab — my mistake report (${subjectText}${dateText ? `, ${dateText}` : ''})`);
  L.push('');
  const t = fb.totals;
  L.push(`Data: ${plural(t.attempts, 'test')}, ${plural(t.answered, 'question')} answered, ${t.correct} correct, ${t.wrong} wrong (accuracy ${t.accuracy ?? '—'}%), ${t.skipped} opened but skipped. Marks lost to wrong answers: ${-t.negative}.`);
  const judged = fb.groups.filter((g) => g.judged);
  if (judged.length) {
    L.push('');
    L.push('Accuracy by sub-topic (weakest first):');
    for (const g of judged) {
      L.push(`- ${g.label}: ${g.correct}/${g.answered} (${g.accuracy}%), avg ${fmtTime(g.avgTimeMs)} per answered question` +
        (g.negative < 0 ? `, ${-g.negative} marks lost` : '') + (g.trend && g.trend.direction !== 'steady' ? `, trend ${g.trend.before}% -> ${g.trend.after}%` : ''));
    }
  }
  const few = fb.groups.filter((g) => !g.judged);
  if (few.length) L.push(`Too few questions to judge yet: ${few.map((g) => `${g.short} (${g.answered})`).join(', ')}.`);
  if (fb.repeated.length) {
    L.push('');
    L.push('Questions I got wrong more than once:');
    for (const r of fb.repeated.slice(0, 15)) L.push(`- ${r.ref} (${r.short}): wrong ${r.wrongCount} times, my answers ${r.answers.join(', ')}, correct ${r.key}${r.lastResult === 'correct' ? ', right the last time' : ''}`);
  }
  if (fb.fastWrong.length) L.push('', `Wrong answers given in under 1 minute: ${fb.fastWrong.length} (${summaryBy(fb.fastWrong)}).`);
  if (fb.slowCorrect.length) L.push(`Correct answers that took over 3 minutes: ${fb.slowCorrect.length} (${summaryBy(fb.slowCorrect)}).`);
  if (fb.reasons.length) L.push('', `Mistake reasons I tagged: ${fb.reasons.map((r) => `${r.label.toLowerCase()} ${r.count}`).join(', ')}.`);
  L.push('');
  L.push('Please look at this data and suggest a short, concrete practice plan for my next week. Use only the numbers above; say so if something is unclear.');
  return L.join('\n');
}

function summaryBy(list) {
  const m = new Map();
  for (const x of list) m.set(x.short, (m.get(x.short) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
}
