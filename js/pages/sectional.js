// Sectional tests the user builds: #/sectional (list + weak-question summary) and
// #/sectional/new (builder: subject, new or weak questions, topics, number of questions, time).
// Choosing the questions is plain code in ../sectional.js; results are saved like any other test.
import { h, fill, confirmDialog } from '../ui.js';
import { listTests, listQuestions, listAllAttempts, listAllQuestionAttempts, saveCustomTest } from '../db.js';
import { getDefaults } from '../settings.js';
import { testQuestionIds } from '../model.js';
import {
  questionHistory, groupAvailability, pickQuestions, suggestedMinutes, buildSectionalTest,
  RIGHT_TO_LEAVE_WEAK,
} from '../sectional.js';
import { SECTIONS, testRow } from './library.js';
import { areasOf, areaLabel, chapterLabel, AREA_LONG } from '../topics.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MODE_TEXT = { new: 'New questions', weak: 'Weak questions' };
const WEAK_RULE = `Weak questions = answered wrong, left unanswered after opening, or correct but over 3 minutes. A question leaves the list after you get it right (within 3 minutes) in ${RIGHT_TO_LEAVE_WEAK} later tests.`;

export async function render(root, params) {
  const [all, questions, records, attempts] = await Promise.all([listTests(), listQuestions(), listAllQuestionAttempts(), listAllAttempts()]);
  const history = questionHistory(records, attempts);
  if (params.view === 'new') return builder(root, params, { all, questions, history });

  const tests = all.filter((t) => t.kind === 'custom').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const weakBox = h('section', { class: 'card', id: 'weak-summary' },
    h('h2', null, 'Your weak questions'),
    h('ul', { class: 'weak-list' }, SECTIONS.map((s) => {
      const n = questions.filter((q) => q.subject === s.subject && history.get(q.id)?.weak).length;
      return h('li', null,
        h('strong', null, s.title), ` ${plural(n, 'question')}`,
        n ? [' · ', h('a', { href: `#/sectional/new?subject=${s.key}&mode=weak`, id: `practise-weak-${s.key}` }, 'Practise them')] : null);
    })),
    h('p', { class: 'muted small' }, WEAK_RULE));
  const list = tests.length
    ? h('div', { class: 'test-list' }, tests.map((t) => testRow(t, testQuestionIds(t).map((id) => byId.get(id)).filter(Boolean),
      attempts.filter((a) => a.testId === t.id),
      { view: false, onDeleted: () => render(root, params), info: `${MODE_TEXT[t.custom?.mode] || ''} · ${plural(t.custom?.requested ?? 0, 'question')} asked for` })))
    : h('div', { class: 'box' }, 'No sectional tests yet. Press "New sectional test" to make one.');
  root.replaceChildren(h('div', { class: 'page' },
    h('p', null, h('a', { href: '#/library' }, '‹ Library')),
    h('div', { class: 'page-head' }, h('h1', null, 'Sectional tests'), h('a', { class: 'btn btn-primary', href: '#/sectional/new', id: 'new-sectional' }, '+ New sectional test')),
    weakBox,
    list));
  return null;
}

function builder(root, params, { all, questions, history }) {
  let section = SECTIONS.find((s) => s.key === params.subject) || SECTIONS[0];
  let mode = params.mode === 'weak' ? 'weak' : 'new';
  let avail = new Map();
  let chosen = new Set();
  let timeEdited = false;
  let nameEdited = false;

  const subjectRadios = h('div', { class: 'choice-row', role: 'radiogroup', 'aria-label': 'Subject' },
    SECTIONS.map((s) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'sec-subject', id: `subj-${s.key}`, value: s.key, checked: s === section,
        onChange: () => { section = s; resetTopics(); update(); } }),
      h('span', null, s.title))));
  const modeRadios = h('div', { class: 'choice-col', role: 'radiogroup', 'aria-label': 'Questions from' },
    h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'sec-mode', id: 'mode-new', checked: mode === 'new', onChange: () => { mode = 'new'; resetTopics(); update(); } }),
      h('span', null, h('strong', null, 'New questions'), h('span', { class: 'muted small' }, ' — questions you have not yet answered correctly in any test'))),
    h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'sec-mode', id: 'mode-weak', checked: mode === 'weak', onChange: () => { mode = 'weak'; resetTopics(); update(); } }),
      h('span', null, h('strong', null, 'My weak questions'), h('span', { class: 'muted small' }, ' — wrong, skipped or slow before'))));
  const topicBox = h('div', { class: 'topic-checks', id: 'topic-checks' });
  const countIn = h('input', { type: 'number', min: 1, max: 200, step: 1, class: 'num', id: 'sec-count' });
  const timeIn = h('input', { type: 'number', min: 1, max: 600, step: 1, class: 'num', id: 'sec-time' });
  const nameIn = h('input', { type: 'text', id: 'sec-name', maxlength: 80 });
  const availLine = h('p', { class: 'filter-summary', id: 'sec-available', role: 'status' });
  const timeHint = h('span', { class: 'muted small' });
  const message = h('div', { id: 'sec-message' });
  const markLine = h('p', { class: 'muted small' });
  const createBtn = h('button', { class: 'btn btn-primary', type: 'button', id: 'create-sectional', onClick: create }, 'Create test');

  countIn.addEventListener('input', update);
  timeIn.addEventListener('input', () => { timeEdited = true; update(); });
  nameIn.addEventListener('input', () => { nameEdited = true; });

  function resetTopics() {
    avail = groupAvailability(questions, history, section.subject, mode);
    chosen = new Set([...avail].filter(([, a]) => a.available > 0).map(([k]) => k));
    const total = [...chosen].reduce((s, k) => s + avail.get(k).available, 0);
    countIn.value = String(Math.max(1, Math.min(section.key === 'varc' ? 24 : 22, total)));
    timeEdited = false;
    drawTopics();
  }

  // Topics (Arithmetic, Algebra, ... / VA, RC / DI, LR), each with its sub-topics underneath.
  function drawTopics() {
    if (!avail.size) {
      topicBox.replaceChildren(h('p', { class: 'muted' }, `No ${section.title} questions in your library yet. `, h('a', { href: '#/add' }, 'Add a DPP PDF'), ' first.'));
      return;
    }
    const known = areasOf(section.subject);
    const groups = [...avail.entries()];
    const present = [...new Set(groups.map(([, g]) => g.area))];
    const areas = [...known.filter((a) => present.includes(a)), ...present.filter((a) => !known.includes(a)).sort()];
    const open = (keys) => keys.filter((k) => avail.get(k).available > 0);
    topicBox.replaceChildren(
      h('div', { class: 'topic-tools' },
        h('button', { type: 'button', class: 'btn btn-small', id: 'topics-all', onClick: () => { chosen = new Set(open(groups.map(([k]) => k))); drawTopics(); update(); } }, 'Select all'),
        h('button', { type: 'button', class: 'btn btn-small', id: 'topics-none', onClick: () => { chosen = new Set(); drawTopics(); update(); } }, 'Clear')),
      ...areas.map((area) => {
        const keys = groups.filter(([, g]) => g.area === area)
          .sort(([, a], [, b]) => (a.chapter === '') - (b.chapter === '') || a.chapter.localeCompare(b.chapter, undefined, { numeric: true }))
          .map(([k]) => k);
        const usable = open(keys);
        const nAvail = keys.reduce((s, k) => s + avail.get(k).available, 0);
        const nTotal = keys.reduce((s, k) => s + avail.get(k).total, 0);
        const all = usable.length > 0 && usable.every((k) => chosen.has(k));
        const some = usable.some((k) => chosen.has(k));
        const areaBox = h('input', { type: 'checkbox', checked: all, disabled: !usable.length, dataset: { area },
          onChange: (e) => { for (const k of usable) { if (e.target.checked) chosen.add(k); else chosen.delete(k); } drawTopics(); update(); } });
        areaBox.indeterminate = some && !all;
        return h('fieldset', { class: 'area-group', dataset: { area } },
          h('legend', null, h('label', { class: 'area-check' + (usable.length ? '' : ' disabled') }, areaBox,
            h('strong', null, areaLabel(area)), AREA_LONG[area] ? h('span', { class: 'muted small' }, ` ${AREA_LONG[area]}`) : null,
            h('span', { class: 'muted small' }, ` · ${nAvail} of ${nTotal} ${mode === 'weak' ? 'weak' : 'new'}`))),
          h('div', { class: 'topic-grid' }, keys.map((k) => {
            const g = avail.get(k);
            return h('label', { class: 'topic-check' + (g.available ? '' : ' disabled'), dataset: { chapter: g.chapter } },
              h('input', { type: 'checkbox', value: k, checked: chosen.has(k), disabled: !g.available,
                onChange: (e) => { if (e.target.checked) chosen.add(k); else chosen.delete(k); drawTopics(); update(); } }),
              h('span', null, chapterLabel(g.chapter)),
              h('span', { class: 'muted small' }, `${g.available} of ${g.total} ${mode === 'weak' ? 'weak' : 'new'}`));
          })));
      }));
  }

  function available() {
    return [...chosen].reduce((s, k) => s + (avail.get(k)?.available || 0), 0);
  }

  function defaultName() {
    const d = new Date();
    const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const base = `${section.title} ${mode === 'weak' ? 'weak questions' : 'sectional'} — ${day}`;
    const same = all.filter((t) => t.kind === 'custom' && t.name.startsWith(base)).length;
    return same ? `${base} (${same + 1})` : base;
  }

  function update() {
    const n = available();
    const want = Math.floor(Number(countIn.value));
    const suggested = suggestedMinutes(section.subject, Number.isFinite(want) && want > 0 ? Math.min(want, n || want) : 1);
    if (!timeEdited) timeIn.value = String(suggested);
    timeHint.textContent = `Suggested ${suggested} min (CAT pace: 40 minutes for ${section.key === 'varc' ? 24 : 22} questions)`;
    if (!nameEdited) nameIn.value = defaultName();
    availLine.textContent = `${plural(n, mode === 'weak' ? 'weak question' : 'new question')} available in ${plural(chosen.size, 'chosen sub-topic')}`;
    availLine.dataset.available = String(n);
    const problems = [];
    const notes = [];
    if (!avail.size) problems.push(`There are no ${section.title} questions yet.`);
    else if (!chosen.size) problems.push(mode === 'weak' && ![...avail.values()].some((a) => a.available) ? `You have no weak ${section.title} questions right now.` : 'Choose at least one topic or sub-topic.');
    else if (!n) problems.push('No questions are available in the chosen sub-topics.');
    if (!(Number.isInteger(Number(countIn.value)) && want >= 1)) problems.push('Number of questions: type a whole number, 1 or more.');
    const t = Number(timeIn.value);
    if (!(Number.isInteger(t) && t >= 1 && t <= 600)) problems.push('Time: type whole minutes between 1 and 600.');
    if (!problems.length && want > n) notes.push(`Only ${n} ${mode === 'weak' ? 'weak' : 'new'} questions are available, so the test will have at most ${n}.`);
    if (section.key !== 'quant') notes.push('Passage sets are kept whole, so the test can have a few questions fewer than you ask for.');
    fill(message,
      problems.length ? h('div', { class: 'box box-error', role: 'alert' }, h('ul', null, problems.map((p) => h('li', null, p)))) : null,
      notes.length ? h('div', { class: 'box box-warn' }, h('ul', null, notes.map((p) => h('li', null, p)))) : null);
    createBtn.disabled = problems.length > 0;
  }

  async function create() {
    update();
    if (createBtn.disabled) return;
    const requested = Math.floor(Number(countIn.value));
    const { questionIds } = pickQuestions({ questions, history, subject: section.subject, groups: [...chosen], mode, count: requested });
    if (!questionIds.length) {
      await confirmDialog({ title: 'No questions could be picked', message: ['The passage sets in the chosen topics are bigger than the number you asked for. Ask for more questions.'], okText: 'OK', cancelText: 'Close' });
      return;
    }
    if (questionIds.length < requested) {
      const ok = await confirmDialog({
        title: `Make a test with ${questionIds.length} questions?`,
        message: [`You asked for ${requested}, but only ${questionIds.length} could be picked from the chosen sub-topics${section.key === 'quant' ? '' : ' (passage sets are kept whole)'}.`],
        okText: `Make it with ${questionIds.length}`, cancelText: 'Go back',
      });
      if (!ok) return;
    }
    const defaults = await getDefaults();
    const byId = new Map(questions.map((q) => [q.id, q]));
    const now = Date.now();
    const test = buildSectionalTest({
      id: `c-${now.toString(36)}`, name: nameIn.value.trim() || defaultName(), subject: section.subject,
      groups: [...chosen], labels: [...chosen].map((k) => `${areaLabel(avail.get(k).area)} › ${chapterLabel(avail.get(k).chapter)}`),
      mode, requested, questionIds, questionsById: byId,
      timeLimitMin: Number(timeIn.value), marking: defaults.marking, nowIso: new Date(now).toISOString(),
    });
    await saveCustomTest(test);
    location.hash = `#/exam/${test.id}`;
  }

  getDefaults().then((d) => {
    const m = d.marking;
    markLine.textContent = `Marks: MCQ +${m.mcq.correct} / ${m.mcq.wrong}, typed answer (TITA) +${m.tita.correct} / ${m.tita.wrong} (your defaults in Settings).`;
  });

  root.replaceChildren(h('div', { class: 'page narrow' },
    h('p', null, h('a', { href: '#/sectional' }, '‹ Sectional tests')),
    h('h1', null, 'New sectional test'),
    h('section', { class: 'card builder' },
      h('h2', null, '1. Subject'), subjectRadios,
      h('h2', null, '2. Questions from'), modeRadios,
      h('p', { class: 'muted small' }, WEAK_RULE),
      h('h2', null, '3. Topics and sub-topics'),
      h('p', { class: 'muted small' }, 'Tick a whole topic, or only some of its sub-topics.'),
      topicBox, availLine,
      h('h2', null, '4. Size and time'),
      h('div', { class: 'builder-fields' },
        h('label', { class: 'field' }, h('span', null, 'Number of questions'), countIn),
        h('label', { class: 'field' }, h('span', null, 'Time (minutes)'), timeIn, timeHint)),
      h('label', { class: 'field' }, h('span', null, 'Name'), nameIn),
      markLine,
      message,
      h('p', null, createBtn, ' ', h('a', { class: 'btn', href: '#/sectional' }, 'Cancel')))));
  resetTopics();
  update();
  return null;
}
