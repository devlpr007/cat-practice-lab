// Library: three sections (Quant, VARC, LRDI) with the DPP tests, plus Mock tests and a card for the
// user's own sectional tests (pages/sectional.js). Inside a section: one card per topic (Arithmetic,
// Algebra, ... / VA, RC / DI, LR, LR based DI). Inside a topic: its DPPs in DPP-number order, a
// sub-topic filter, and the number of tests and questions that match. A test is a list of question
// references (model.js), so counts come from the questions themselves.
import { h, formatDate, confirmDialog } from '../ui.js';
import { listTests, listQuestions, deleteTest, deletionPlan, listAllAttempts, listSources } from '../db.js';
import { startAgain } from './exam.js';
import { backupReminder } from './backup.js';
import { testQuestionIds } from '../model.js';
import { areasOf, chaptersOf, areaLabel, chapterLabel, groupLabel, AREA_LONG, NOT_SET_KEY, topicHref } from '../topics.js';

export const SECTIONS = [
  { key: 'quant', subject: 'Quantitative Aptitude', title: 'Quant', long: 'Quantitative Aptitude' },
  { key: 'varc', subject: 'VARC', title: 'VARC', long: 'Verbal Ability & Reading Comprehension' },
  { key: 'lrdi', subject: 'LRDI', title: 'LRDI', long: 'Logical Reasoning & Data Interpretation' },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function render(root, params) {
  const all = await listTests();
  const tests = all.filter((t) => t.kind === 'pdf');
  const sectional = all.filter((t) => t.kind === 'custom');
  const mocks = all.filter((t) => t.kind === 'mock').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const questions = new Map((await listQuestions()).map((q) => [q.id, q]));
  const attempts = await listAllAttempts();
  const sources = new Map((await listSources()).map((s) => [s.id, s]));
  // DPP order: by the DPP number from the PDF (00 .. n), then by name; tests without a number last
  const dppNo = (t) => { const d = t.sourceIds.map((id) => sources.get(id)?.dpp).find((x) => x != null && String(x).trim() !== ''); const n = d == null ? NaN : parseInt(String(d), 10); return Number.isFinite(n) ? n : Infinity; };
  const byDpp = (a, b) => dppNo(a) - dppNo(b) || a.name.localeCompare(b.name, undefined, { numeric: true });
  const attemptsOf = (testId) => attempts.filter((a) => a.testId === testId);
  const qsOf = (t) => testQuestionIds(t).map((id) => questions.get(id)).filter(Boolean);
  const section = SECTIONS.find((s) => s.key === params.section);

  if (params.section === 'mock') {
    root.replaceChildren(h('div', { class: 'page' },
      h('p', null, h('a', { href: '#/library', id: 'all-sections' }, '‹ All sections')),
      h('div', { class: 'page-head' }, h('h1', null, 'Mock tests'), h('a', { class: 'btn btn-primary', href: '#/add' }, '+ Add PDF')),
      h('p', { class: 'filter-summary', id: 'filter-summary' }, `${plural(mocks.length, 'mock')} · ${plural(mocks.reduce((s, t) => s + qsOf(t).length, 0), 'question')}`),
      mocks.length
        ? h('div', { class: 'test-list' }, mocks.map((t) => testRow(t, qsOf(t), attemptsOf(t.id), { onDeleted: () => render(root, params), info: t.sections.map((s) => `${s.name} ${s.questionIds.length} q · ${s.timeLimitMin} min`).join(' · ') })))
        : h('div', { class: 'box' }, 'No mock tests yet. Add a CAT mock PDF (question paper with Answers and Explanations) with ', h('a', { href: '#/add' }, '+ Add PDF'), '.')));
    return null;
  }

  if (!section) {
    // ---- the three section cards ----
    const cards = SECTIONS.map((s) => {
      const ts = tests.filter((t) => qsOf(t).some((q) => q.subject === s.subject));
      const nq = new Set(ts.flatMap((t) => qsOf(t).filter((q) => q.subject === s.subject).map((q) => q.id))).size;
      const subs = new Set(ts.flatMap((t) => qsOf(t).filter((q) => q.subject === s.subject).map(groupLabel))).size;
      return h('a', { class: 'section-card', href: `#/library/${s.key}`, id: `section-${s.key}` },
        h('span', { class: 'section-title' }, s.title),
        h('span', { class: 'muted small' }, s.long),
        h('span', { class: 'section-count', dataset: { questions: String(nq) } }, plural(nq, 'question')),
        h('span', { class: 'muted small' }, `${plural(ts.length, 'test')} · ${plural(subs, 'sub-topic')}`));
    });
    const mockQs = mocks.reduce((s, t) => s + qsOf(t).length, 0);
    const mockDone = attempts.filter((a) => a.status === 'submitted' && mocks.some((t) => t.id === a.testId)).length;
    cards.push(h('a', { class: 'section-card section-card-mock', href: '#/library/mock', id: 'section-mock' },
      h('span', { class: 'section-title' }, 'Mock tests'),
      h('span', { class: 'muted small' }, 'Full CAT mocks: VARC, DILR and QA with their own clocks'),
      h('span', { class: 'section-count' }, `${plural(mocks.length, 'mock')} · ${plural(mockQs, 'question')}`),
      h('span', { class: 'muted small' }, `${plural(mockDone, 'attempt')} submitted`)));
    const sectionalDone = attempts.filter((a) => a.status === 'submitted' && sectional.some((t) => t.id === a.testId)).length;
    cards.push(h('a', { class: 'section-card section-card-own', href: '#/sectional', id: 'section-sectional' },
      h('span', { class: 'section-title' }, 'Sectional tests'),
      h('span', { class: 'muted small' }, 'Build your own test from chosen topics, or practise your weak questions'),
      h('span', { class: 'section-count' }, plural(sectional.length, 'test')),
      h('span', { class: 'muted small' }, `${plural(sectionalDone, 'attempt')} submitted`)));
    const reminder = await backupReminder();
    let seen = true;
    try { seen = !!localStorage.getItem('cpl.firstRunSeen'); } catch { /* private window */ }
    const notice = seen ? null : h('div', { class: 'box box-warn first-run', id: 'first-run', role: 'note' },
      h('strong', null, 'Add only PDFs you have the right to use. This app contains no institute material.'), ' ',
      'What you add stays on your device (and, if you sign in, in your own Google Drive). ', h('a', { href: '#/privacy' }, 'Privacy'), ' ',
      h('button', { type: 'button', class: 'btn btn-small', id: 'first-run-ok', onClick: () => { try { localStorage.setItem('cpl.firstRunSeen', '1'); } catch { /* ignore */ } notice.remove(); } }, 'OK'));
    root.replaceChildren(h('div', { class: 'page' },
      notice,
      reminder,
      h('div', { class: 'page-head' }, h('h1', null, 'Library'), h('a', { class: 'btn btn-primary', href: '#/add' }, '+ Add PDF')),
      h('div', { class: 'section-cards' }, cards),
      tests.length ? null : h('div', { class: 'box' }, h('p', null, 'No tests yet. '), h('p', null, h('a', { href: '#/add' }, 'Add your first DPP PDF')), ' to turn it into a test.')));
    return null;
  }

  // ---- one section: a card per topic (Arithmetic, Algebra, ... / VA, RC / DI, LR, LR based DI) ----
  const inSection = tests.filter((t) => qsOf(t).some((q) => q.subject === section.subject));
  const sectionQs = inSection.flatMap((t) => qsOf(t).filter((q) => q.subject === section.subject));
  const countBy = (list, key) => list.reduce((m, q) => m.set(key(q), (m.get(key(q)) || 0) + 1), new Map());
  const areaCounts = countBy(sectionQs, (q) => q.area || '');
  const known = areasOf(section.subject);
  // every known topic (even with no DPP yet), then any other topic that has questions, "Not set" last
  const areas = [...known, ...[...areaCounts.keys()].filter((a) => a !== '' && !known.includes(a)).sort(), ...(areaCounts.has('') ? [''] : [])];
  const area = params.topic == null ? null : params.topic === NOT_SET_KEY ? '' : params.topic;

  if (area == null || !areas.includes(area)) {
    const cards = areas.map((a) => {
      const ts = inSection.filter((t) => qsOf(t).some((q) => q.subject === section.subject && (q.area || '') === a));
      const nq = areaCounts.get(a) || 0;
      const subs = new Set(sectionQs.filter((q) => (q.area || '') === a).map((q) => q.chapter || '')).size;
      return h('a', { class: 'section-card topic-card', href: topicHref(section.subject, a), id: `topic-${topicId(a)}` },
        h('span', { class: 'section-title' }, areaLabel(a)),
        h('span', { class: 'muted small' }, a === '' ? 'DPPs whose topic is not chosen yet' : AREA_LONG[a] || topicHint(a)),
        h('span', { class: 'section-count', dataset: { questions: String(nq) } }, plural(nq, 'question')),
        h('span', { class: 'muted small' }, `${plural(ts.length, 'test')} · ${plural(subs, 'sub-topic')}`));
    });
    root.replaceChildren(h('div', { class: 'page' },
      h('p', null, h('a', { href: '#/library', id: 'all-sections' }, '‹ All sections')),
      h('div', { class: 'page-head' }, h('h1', null, `${section.title} tests`), h('a', { class: 'btn btn-primary', href: '#/add' }, '+ Add PDF')),
      h('p', { class: 'filter-summary', id: 'filter-summary' }, `${plural(inSection.length, 'test')} · ${plural(sectionQs.length, 'question')} in ${section.title} — choose a topic`),
      h('div', { class: 'section-cards topic-cards' }, cards),
      inSection.length ? null : h('div', { class: 'box' }, `No ${section.title} tests yet. `, h('a', { href: '#/add' }, 'Add a DPP PDF'), '.')));
    return null;
  }

  // ---- one topic: its DPPs in DPP order, a Sub-topic filter and live counts ----
  let chapter = params.sub != null ? params.sub : null;
  const chapterSel = h('select', { id: 'subtopic-filter', 'aria-label': 'Filter by sub-topic' });
  const summary = h('p', { class: 'filter-summary', id: 'filter-summary', role: 'status' });
  const list = h('div', { class: 'test-list' });
  const matches = (q) => q.subject === section.subject && (q.area || '') === area && (chapter == null || (q.chapter || '') === chapter);
  const chapterCounts = countBy(sectionQs.filter((q) => (q.area || '') === area), (q) => q.chapter || '');
  if (chapter != null && !chapterCounts.has(chapter)) chapter = null;
  const chapters = [...chapterCounts.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, undefined, { numeric: true }));
  chapterSel.replaceChildren(h('option', { value: '*' }, `All sub-topics (${chapters.length})`),
    ...chapters.map((c) => h('option', { value: c, selected: c === chapter }, `${chapterLabel(c)} (${plural(chapterCounts.get(c), 'question')})`)));
  chapterSel.value = chapter == null ? '*' : chapter;

  const drawList = () => {
    const shown = inSection.filter((t) => qsOf(t).some(matches)).sort(byDpp);
    const nq = shown.reduce((s, t) => s + qsOf(t).filter(matches).length, 0);
    const where = chapter == null ? `"${areaLabel(area)}"` : `"${areaLabel(area)} › ${chapterLabel(chapter)}"`;
    summary.textContent = `${plural(shown.length, 'test')} · ${plural(nq, 'question')} in ${where}`;
    summary.dataset.questions = String(nq);
    list.replaceChildren(...(shown.length ? shown.map((t) => testRow(t, qsOf(t), attemptsOf(t.id), { onDeleted: () => render(root, params) })) : [h('div', { class: 'box' }, `No ${section.title} tests in "${areaLabel(area)}" yet. `, h('a', { href: '#/add' }, 'Add a DPP PDF'), '.')]));
  };
  const remember = () => {
    const q = new URLSearchParams();
    if (chapter != null) q.set('sub', chapter);
    history.replaceState(null, '', topicHref(section.subject, area) + (q.toString() ? `?${q}` : ''));
  };
  chapterSel.addEventListener('change', () => { chapter = chapterSel.value === '*' ? null : chapterSel.value; remember(); drawList(); });

  root.replaceChildren(h('div', { class: 'page' },
    h('p', null, h('a', { href: '#/library', id: 'all-sections' }, '‹ All sections'), ' · ', h('a', { href: `#/library/${section.key}`, id: 'all-topics' }, `‹ ${section.title} topics`)),
    h('div', { class: 'page-head' },
      h('h1', null, areaLabel(area), AREA_LONG[area] ? h('span', { class: 'muted small h1-sub' }, ` ${AREA_LONG[area]}`) : null),
      h('a', { class: 'btn btn-primary', href: '#/add' }, '+ Add PDF')),
    h('div', { class: 'filter-bar' },
      h('label', { for: 'subtopic-filter' }, 'Sub-topic'), chapterSel,
      summary),
    list));
  drawList();
  return null;
}

/** The first few known sub-topics of a topic, as a hint on its card ("Percentage, Averages, …"). */
const topicHint = (a) => { const c = chaptersOf(a); return c.length ? c.slice(0, 3).join(', ') + (c.length > 3 ? ', …' : '') : ''; };
/** A safe element id for any topic name ("Number System" -> topic-number-system). */
const topicId = (a) => (a === '' ? 'not-set' : a.toLowerCase().replace(/[^a-z0-9]+/g, '-'));

/**
 * One test in a list: name, topics, size, last result and the buttons. Used by the library
 * sections and by the sectional-tests page. qs = the test's questions, mine = its attempts.
 */
export function testRow(t, qs, mine, { onDeleted, view = true, info = null }) {
  const mcq = qs.filter((q) => q.type === 'MCQ').length;
  const edited = qs.filter((q) => q.answerEditedByUser).length;
  const approved = qs.length > 0 && qs.every((q) => q.keyApprovedAt);
  const running = mine.find((a) => a.status === 'in-progress');
  const done = mine.filter((a) => a.status === 'submitted').sort((a, b) => b.submittedAt - a.submittedAt);
  const last = done[0];
  return h('article', { class: 'test-row', dataset: { testId: t.id } },
    h('div', { class: 'test-info' },
      h('h2', null, h('a', { href: `#/test/${t.id}` }, t.name)),
      h('p', null, t.kind === 'mock' ? 'Full CAT mock' : [...new Set(qs.map(groupLabel))].join(', ')),
      info ? h('p', { class: 'small' }, info) : null,
      h('p', { class: 'muted small' },
        `${qs.length} questions (${mcq} MCQ, ${qs.length - mcq} TITA) · ${t.settings.timeLimitMin} min · ${t.kind === 'custom' ? 'made' : 'added'} ${formatDate(t.createdAt)}`,
        edited ? ` · ${edited} answer(s) edited by you` : ''),
      last ? h('p', { class: 'small last-result' },
        `Last result: ${fmt(last.summary?.score)} / ${fmt(last.summary?.maxScore)}`,
        ` · ${formatDate(new Date(last.submittedAt).toISOString())}`,
        done.length > 1 ? ` · ${done.length} attempts` : '') : null),
    h('div', { class: 'test-actions' },
      t.kind === 'mock'
        ? h('a', { class: 'btn btn-primary', href: `#/exam/${t.id}`, id: `start-${t.id}` }, running ? 'Resume mock' : last ? 'Take again' : 'Start mock')
        : approved
          ? h('a', { class: 'btn btn-primary', href: `#/exam/${t.id}`, id: `start-${t.id}` }, running ? 'Resume test' : last ? 'Take again' : 'Start test')
          : h('button', { class: 'btn btn-primary', type: 'button', disabled: true, title: 'Approve the answer key first' }, 'Start test'),
      running ? h('button', { class: 'btn', type: 'button', onClick: () => startAgain(t.id, running) }, 'Start again') : null,
      last ? h('a', { class: 'btn', href: `#/result/${last.id}` }, 'Results') : null,
      view ? h('a', { class: 'btn', href: `#/test/${t.id}` }, 'View') : null,
      h('button', {
        class: 'btn btn-danger-outline', type: 'button',
        onClick: async () => { if (await confirmDelete(t.id)) onDeleted(); },
      }, 'Delete')));
}

function fmt(n) {
  return n == null ? '—' : Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** Ask, explaining exactly what will be removed; delete only if the user agrees. */
export async function confirmDelete(testId) {
  const plan = await deletionPlan(testId);
  if (!plan) return false;
  const lines = [];
  if (plan.test.kind === 'custom') lines.push('This removes this sectional test. Its questions stay in your library (they belong to your DPP tests).');
  else if (plan.sources.length) lines.push(`This removes the test and its ${plan.sources.reduce((s, x) => s + x.questionIds.length, 0)} questions and pictures from this device.`);
  else lines.push('This removes the test. Its questions stay, because another test uses them.');
  lines.push(plan.attempts.length ? `Your ${plan.attempts.length} attempt(s) of this test will also be deleted, and will no longer count for your weak questions.` : 'You have no attempts of this test yet.');
  lines.push('This cannot be undone. (Your PDF file itself is not touched.)');
  const ok = await confirmDialog({ title: `Delete "${plan.test.name}"?`, message: lines, okText: 'Delete test', cancelText: 'Keep it', danger: true });
  if (ok) await deleteTest(testId);
  return ok;
}
