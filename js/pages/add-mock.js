// Review page for a mock PDF (Stage 7a): validation report, test details (name, minutes per
// section, marks), every question grouped by section with its answer-key picture and explanation,
// the answer-key approval and Save. Same rules as the DPP review: nothing is saved before approval,
// answers can be corrected by hand (marked "edited by me"), the detected value is always kept.
import { h, fill, confirmDialog } from '../ui.js';
import { questionCard } from '../components/question-card.js';
import { saveImport } from '../db.js';
import { getDefaults } from '../settings.js';
import { validateMockDraft, setLabel } from '../parser/mock-structure.js';
import { answerKind } from '../parser/validate.js';
import { buildMockRecords, MOCK_SECTION_MINUTES } from '../mock-record.js';
import { settingsProblems } from '../test-record.js';

/**
 * Show the review page for a parsed mock draft inside `root`.
 * bag: UrlBag for picture URLs; setUnsaved(bool); batch: null or { index, total, reasons, onDone }.
 */
export async function renderMockReview(root, draft, { bag, setUnsaved, batch = null }) {
  setUnsaved(true);
  const defaults = await getDefaults();
  const pic = (id) => (id && draft.images[id] ? { src: bag.url(draft.images[id].blob), width: draft.images[id].width, height: draft.images[id].height } : null);
  const form = { name: draft.name, sectionMinutes: MOCK_SECTION_MINUTES, marking: structuredClone(defaults.marking) };
  let approved = false;
  let onlyFlagged = false;
  const reportBox = h('section', { class: 'card' });
  const saveBar = h('div', { class: 'savebar' });

  const refresh = () => {
    const rep = validateMockDraft(draft);
    const sProblems = settingsProblems({ timeLimitMin: form.sectionMinutes, marking: form.marking }).map((p) => p.replace('Time limit', 'Minutes per section'));
    if (!form.name.trim()) sProblems.push('Type a name for the mock.');
    renderReport(rep, sProblems);
    renderSaveBar(rep, sProblems);
  };
  function renderReport(rep, sProblems) {
    const toDo = [...rep.errors, ...sProblems];
    fill(reportBox,
      h('h2', null, 'Validation report'),
      h('table', { class: 'report' }, h('tbody', null, rep.checks.map((c) => h('tr', { class: c.ok ? 'ok' : 'bad' }, h('td', { class: 'mark' }, c.ok ? '✓' : '!'), h('td', null, c.label), h('td', null, c.detail))))),
      h('p', { class: 'muted small' }, `PDF: ${draft.file.name} · ${draft.file.pages} pages · read in ${Math.round(draft.timings.totalMs / 1000)} s`),
      toDo.length ? h('div', { class: 'box box-error' }, h('h3', null, 'To do before saving'), h('ul', null, toDo.map((e) => h('li', null, e)))) : null,
      rep.warnings.length ? h('div', { class: 'box box-warn' }, h('h3', null, 'Please check'), h('ul', null, rep.warnings.map((w) => h('li', null, w)))) : null);
  }
  function renderSaveBar(rep, sProblems) {
    const blockers = rep.errors.length + sProblems.length;
    const checkbox = h('input', { type: 'checkbox', id: 'approve-key', checked: approved });
    checkbox.addEventListener('change', () => { approved = checkbox.checked; refresh(); });
    fill(saveBar,
      h('label', { class: 'approve', for: 'approve-key' }, checkbox, ` I have compared all ${draft.questions.length} answers with the answer-key pictures and approve this answer key.`),
      h('div', { class: 'savebar-row' },
        h('span', { class: blockers ? 'error' : 'muted' }, blockers ? `${blockers} thing(s) to fix first (see the report at the top).` : approved ? 'Ready to save.' : 'Tick the box to approve the answer key.'),
        h('button', { class: 'btn', type: 'button', onClick: async () => {
          if (await confirmDialog({ title: 'Discard this mock?', message: 'Nothing will be saved.', okText: 'Discard', cancelText: 'Keep checking' })) {
            setUnsaved(false); bag.free();
            if (batch) batch.onDone('discarded'); else location.hash = '#/add';
          }
        } }, 'Discard'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: !(blockers === 0 && approved), id: 'save-test', onClick: save }, 'Save mock')));
  }
  async function save() {
    try {
      const now = new Date().toISOString();
      const records = buildMockRecords(draft, form, now, now);
      await saveImport(records);
      import('../sync/account.js').then((m) => m.syncSoon()).catch(() => {});
      setUnsaved(false); bag.free();
      if (batch) { batch.onDone('saved', records.test); return; }
      location.hash = `#/test/${records.test.id}?saved=1`;
    } catch (err) {
      console.error(err);
      await confirmDialog({ title: 'The mock was not saved', message: [String(err && err.message ? err.message : err)], okText: 'OK', cancelText: 'Close' });
    }
  }

  // details
  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', null, label), control, hint ? h('span', { class: 'muted small' }, hint) : null);
  const nameIn = h('input', { type: 'text', id: 'mock-name', value: form.name, maxlength: 80 });
  nameIn.addEventListener('input', () => { form.name = nameIn.value; refresh(); });
  const num = (value, onChange, attrs = {}) => { const el = h('input', { type: 'number', value: String(value), step: 'any', class: 'num', ...attrs }); el.addEventListener('input', () => { onChange(el.value); refresh(); }); return el; };
  const details = h('section', { class: 'card' },
    h('h2', null, 'Mock details'),
    h('p', { class: 'muted small' }, 'Like the real CAT: three sections in fixed order (VARC → DILR → QA), each with its own clock; you cannot go back to a finished section.'),
    h('div', { class: 'form-grid' },
      field('Name', nameIn),
      field('Minutes per section', num(form.sectionMinutes, (v) => { form.sectionMinutes = v; }, { min: 1, max: 180, step: 1, id: 'section-minutes' }), `CAT gives ${MOCK_SECTION_MINUTES}. Total = 3 × this.`)),
    h('h3', null, 'Marks'),
    h('div', { class: 'form-grid' },
      field('MCQ correct', num(form.marking.mcq.correct, (v) => { form.marking.mcq.correct = v; })),
      field('MCQ wrong', num(form.marking.mcq.wrong, (v) => { form.marking.mcq.wrong = v; })),
      field('TITA correct', num(form.marking.tita.correct, (v) => { form.marking.tita.correct = v; })),
      field('TITA wrong', num(form.marking.tita.wrong, (v) => { form.marking.tita.wrong = v; }))));

  // cards, grouped by section
  const setsById = new Map(draft.sets.map((s) => [s.id, s]));
  const cards = [];
  const groups = draft.sections.map((sec) => {
    const qs = draft.questions.filter((q) => q.section === sec.key);
    const els = qs.map((q) => {
      const card = questionCard({
        n: q.n, answer: q.answer, optionsMode: q.optionsMode, stemHeight: q.stemHeight, markersFound: q.markersFound,
        notes: (q.issues || []).map((i) => i.text), setId: q.setId, setLabel: q.setId && setsById.get(q.setId) ? setLabel(setsById.get(q.setId)) : null,
        pics: { question: pic(q.images.question), options: q.images.options ? Object.fromEntries(Object.entries(q.images.options).map(([L, id]) => [L, pic(id)])) : null, solution: pic(q.images.solution), keyStrip: pic(q.images.keyStrip), passage: pic(q.images.passage) },
      }, {
        onAnswer: (value) => {
          const v = String(value ?? '').trim();
          q.answer.value = answerKind(v) === 'MCQ' ? v.toUpperCase() : v;
          q.answer.edited = q.answer.value !== (q.answer.detected ?? '');
          if (approved) approved = false;
          refresh();
        },
      });
      cards.push(card);
      return card;
    });
    return h('section', { class: 'card mock-section', id: `section-${sec.key}` },
      h('h2', null, `${sec.display} — Q${sec.from}–Q${sec.to} (${sec.count} questions)`),
      h('div', { class: 'cards' }, els));
  });
  const filterBox = h('input', { type: 'checkbox', id: 'only-flagged' });
  filterBox.addEventListener('change', () => { onlyFlagged = filterBox.checked; for (const c of cards) c.hidden = onlyFlagged && c.dataset.flagged !== 'yes'; });

  root.replaceChildren(h('div', { class: 'page' },
    h('h1', null, batch ? `Check ${batch.index} of ${batch.total}: ${draft.file.name}` : 'Check this mock before saving'),
    h('p', null, 'Nothing is saved until you approve the answer key and press "Save mock" at the bottom.'),
    batch && batch.reasons?.length ? h('div', { class: 'box box-warn', id: 'batch-reasons' }, h('h3', null, 'Why the app is asking you about this PDF'), h('ul', null, batch.reasons.map((x) => h('li', null, x)))) : null,
    reportBox,
    details,
    h('section', { class: 'card' },
      h('h2', null, 'Answer key and pictures'),
      h('p', null, 'For every question, compare the answer the app read with the answer-key picture next to it. If one is wrong, click the right letter or type the number — it will be marked "edited by me". Click any picture to enlarge it.'),
      h('label', { class: 'inline' }, filterBox, ' Show only flagged or edited questions')),
    groups,
    saveBar));
  refresh();
}
