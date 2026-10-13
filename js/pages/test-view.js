// A saved test: details, approved answer key and every picture (read-only).
import { h, UrlBag, picture, formatDate } from '../ui.js';
import { getTest, getSource, getQuestions, getImagesForSources, setTestTimeLimit, listAttempts, setSourceTopic } from '../db.js';
import { areasOf, chaptersOf, areaLabel, chapterLabel, AREA_LONG } from '../topics.js';
import { testQuestionIds } from '../model.js';
import { confirmDelete } from './library.js';
import { questionCard } from '../components/question-card.js';

export async function render(root, params) {
  const bag = new UrlBag();
  const test = await getTest(params.id);
  if (!test) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', null, 'Test not found'), h('p', null, h('a', { href: '#/library' }, 'Back to the library'))));
    return { cleanup: () => bag.free() };
  }
  const questions = await getQuestions(testQuestionIds(test));
  const sources = (await Promise.all(test.sourceIds.map(getSource))).filter(Boolean);
  const images = await getImagesForSources(test.sourceIds);
  const source = sources.length === 1 ? sources[0] : null;
  const pic = (id) => {
    const im = id && images.get(id);
    return im ? { src: bag.url(im.blob), width: im.width, height: im.height } : null;
  };
  const m = test.settings.marking;
  const setLabels = new Map();
  for (const q of questions) {
    if (!q.setId) continue;
    const l = setLabels.get(q.setId);
    setLabels.set(q.setId, l ? { from: l.from, to: q.n } : { from: q.n, to: q.n });
  }
  const setLabel = (q) => (q.setId && setLabels.get(q.setId) ? `Q${setLabels.get(q.setId).from}–Q${setLabels.get(q.setId).to}` : null);
  const cards = questions.map((q) => questionCard({
    n: q.n,
    answer: { value: q.answer, detected: q.answerDetected, edited: q.answerEditedByUser },
    optionsMode: q.optionsMode,
    stemHeight: q.stemHeight,
    notes: q.flags || [],
    setId: q.setId, setLabel: setLabel(q),
    pics: {
      question: pic(q.images.question),
      options: q.images.options ? Object.fromEntries(Object.entries(q.images.options).map(([L, id]) => [L, pic(id)])) : null,
      solution: pic(q.images.solution),
      keyStrip: pic(q.images.keyStrip),
      passage: pic(q.images.passage),
    },
  }));
  const header = source ? pic(source.headerImage) : null;
  const attempts = (await listAttempts(test.id)).filter((x) => x.status === 'submitted').sort((x, y) => y.submittedAt - x.submittedAt);
  const mcq = questions.filter((q) => q.type === 'MCQ').length;
  const approved = [...new Set(sources.map((s) => s.keyApproval?.approvedAt).filter(Boolean))];
  const edited = questions.filter((q) => q.answerEditedByUser).length;
  root.replaceChildren(h('div', { class: 'page' },
    params.saved ? h('div', { class: 'box box-ok', role: 'status' }, h('strong', null, 'Saved. '), 'The test is in your library.') : null,
    h('div', { class: 'page-head' },
      h('h1', null, test.name),
      h('div', { class: 'test-actions' },
        h('a', { class: 'btn btn-primary', href: `#/exam/${test.id}` }, 'Start test'),
        h('a', { class: 'btn', href: '#/library' }, 'Back to library'))),
    h('section', { class: 'card' },
      header ? picture(header.src, { ...header, alt: 'PDF heading', scale: 0.45 }) : null,
      h('table', { class: 'facts' }, h('tbody', null,
        [...(test.kind === 'mock' ? [['Sections', test.sections.map((s) => `${s.name}: ${s.questionIds.length} questions, ${s.timeLimitMin} min`).join(' · ')]] : []),
          ['Subject', [...new Set(questions.map((q) => q.subject))].join(', ')], ['Topic', [...new Set(questions.map((q) => areaLabel(q.area)))].join(', ')], ['Sub-topic', [...new Set(questions.map((q) => chapterLabel(q.chapter)))].join(', ')],
          ['PDF heading', [...new Set(questions.map((q) => q.topic))].join(', ')], ['Questions', `${questions.length} (${mcq} MCQ, ${questions.length - mcq} TITA)`],
          ['Time limit', `${test.settings.timeLimitMin} minutes`],
          ['Marks', `MCQ +${m.mcq.correct} / ${m.mcq.wrong}, TITA +${m.tita.correct} / ${m.tita.wrong}`],
          ['Answer key', `approved by you on ${approved.map(formatDate).join(', ')}` + (edited ? ` (${edited} answer(s) edited by you)` : '')],
          ['Source PDF', sources.map((s) => `${s.fileName} (${s.pages} pages, ${s.kind === 'text' ? 'with text layer' : 'no text layer'})`).join('; ')],
          ['Added', formatDate(test.createdAt)]].map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v))))),
      timeLimitEditor(test),
      test.kind === 'pdf' && source ? topicEditor(source, () => render(root, params)) : null,
      source?.warnings?.length ? h('div', { class: 'box box-warn' }, h('ul', null, source.warnings.map((w) => h('li', null, w)))) : null),
    h('section', { class: 'card' },
      h('h2', null, 'Your attempts'),
      attempts.length
        ? h('ul', { class: 'attempt-list' }, attempts.map((x) => h('li', null,
          h('span', null, `${formatDate(new Date(x.submittedAt).toISOString())}${x.mode === 'practice' ? ' (practice)' : ''}`),
          h('span', null, x.summary ? `Score ${x.summary.score} / ${x.summary.maxScore} · ${x.summary.correct} correct, ${x.summary.incorrect} wrong, ${x.summary.skipped} skipped` : ''),
          h('a', { href: `#/result/${x.id}` }, 'Results'))))
        : h('p', { class: 'muted' }, 'Not attempted yet.')),
    h('section', { class: 'card' }, h('h2', null, 'Questions, answer key and solutions'), h('div', { class: 'cards' }, cards)),
    h('section', { class: 'card' },
      h('h2', null, 'Delete this test'),
      h('p', { class: 'muted' }, 'You will be told exactly what is removed before anything is deleted. Your PDF file is not touched.'),
      h('button', {
        class: 'btn btn-danger-outline', type: 'button',
        onClick: async () => { if (await confirmDelete(test.id)) location.hash = '#/library'; },
      }, 'Delete test'))));
  return { cleanup: () => bag.free() };
}

function timeLimitEditor(test) {
  const input = h('input', { type: 'number', min: 1, max: 600, step: 1, value: String(test.settings.timeLimitMin), class: 'num', id: 'time-limit-edit' });
  const msg = h('span', { role: 'status', class: 'small' });
  return h('div', { class: 'inline-edit' },
    h('label', { for: 'time-limit-edit' }, 'Time limit for this test (minutes): '), input, ' ',
    h('button', { class: 'btn btn-small', type: 'button', id: 'save-time-limit', onClick: async () => {
      const v = Number(input.value);
      if (!Number.isInteger(v) || v < 1 || v > 600) { msg.className = 'error small'; msg.textContent = 'Use a whole number from 1 to 600.'; return; }
      await setTestTimeLimit(test.id, v);
      test.settings.timeLimitMin = v;
      msg.className = 'ok small';
      msg.textContent = 'Saved. Used the next time you start this test.';
    } }, 'Save'), ' ', msg);
}

/** Change the Topic and Sub-topic of the PDF behind this test (all its questions follow). */
function topicEditor(source, redraw) {
  const areaSel = h('select', { id: 'area-edit' },
    h('option', { value: '' }, '— choose —'),
    areasOf(source.subject).map((a) => h('option', { value: a, selected: a === source.area }, AREA_LONG[a] ? `${a} (${AREA_LONG[a]})` : a)));
  const chapterIn = h('input', { type: 'text', id: 'chapter-edit', value: source.chapter || '', list: 'chapter-edit-list', maxlength: 80 });
  const list = h('datalist', { id: 'chapter-edit-list' }, chaptersOf(source.area).map((c) => h('option', { value: c })));
  areaSel.addEventListener('change', () => list.replaceChildren(...chaptersOf(areaSel.value).map((c) => h('option', { value: c }))));
  const msg = h('span', { role: 'status', class: 'small' });
  return h('div', { class: 'inline-edit' },
    h('label', { for: 'area-edit' }, 'Topic: '), areaSel, ' ',
    h('label', { for: 'chapter-edit' }, 'Sub-topic: '), chapterIn, list, ' ',
    h('button', { class: 'btn btn-small', type: 'button', id: 'save-topic', onClick: async () => {
      const area = areaSel.value;
      const chapter = chapterIn.value.trim();
      if (!area || !chapter) { msg.className = 'error small'; msg.textContent = 'Choose the topic and type the sub-topic.'; return; }
      await setSourceTopic(source.id, area, chapter);
      redraw();
    } }, 'Save'), ' ', msg);
}
