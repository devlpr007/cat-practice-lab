// "Add PDF": choose one PDF -> it is read on this device -> refused with reasons, or shown on the
// parser review page (validation report + every crop + answer key to check and correct) -> saved.
// Choose MANY PDFs (user, 2026-10-13): they are read one after another; a PDF with no doubts at all
// (text layer, every answer read clearly, no flags, subject / topic / sub-topic known) is saved at
// once with its key approved; every other PDF is queued and shown on the review page for the user
// to check, one by one. Refused and duplicate PDFs are listed at the end.
import { h, fill, UrlBag, picture, confirmDialog } from '../ui.js';
import { parsePdf, sha256Hex } from '../parser/parse-pdf.js';
import { validateDraft, answerKind } from '../parser/validate.js';
import { SUBJECTS } from '../parser/filename.js';
import { questionCard } from '../components/question-card.js';
import { getSource, listSources, saveImport } from '../db.js';
import { getDefaults } from '../settings.js';
import { buildRecords, settingsProblems } from '../test-record.js';
import { sourceIdFromSha } from '../model.js';
import { formatBytes } from '../ui.js';
import { areasOf, chaptersOf, classifyTopic, AREA_LONG } from '../topics.js';
import { detectPdfFormat, parseMock } from '../parser/parse-mock.js';
import { renderMockReview } from './add-mock.js';

export async function render(root) {
  const bag = new UrlBag();
  let unsaved = false;
  root.replaceChildren(chooser());

  function chooser(message = null) {
    const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'pdf-input', class: 'visually-hidden', multiple: true });
    input.addEventListener('change', () => input.files.length && start([...input.files]));
    const drop = h('label', { class: 'dropzone', for: 'pdf-input' },
      h('strong', null, 'Click here to choose one or many DPP PDFs'),
      h('span', { class: 'muted' }, 'or drag the PDF files onto this box'),
      h('span', { class: 'muted small' }, 'The PDFs are read on this device only. Nothing is uploaded. With many files, the ones that read cleanly are saved by themselves; you are asked only about the doubtful ones.'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const fs = [...e.dataTransfer.files];
      if (fs.length) start(fs);
    });
    return h('div', { class: 'page narrow' },
      h('h1', null, 'Add a PDF'),
      h('p', { class: 'small', id: 'rights-note' }, h('strong', null, 'Add only PDFs you have the right to use. This app contains no institute material.'), ' The PDF is read on this device and is not uploaded anywhere.'),
      message,
      input, drop,
      h('p', { class: 'muted' }, 'Supported: your institute\'s DPPs (two-column question pages, an "Answer Key" page, then "Hints & Solutions") and full CAT mock PDFs in the question-paper format (VARC, LRDI, Quant; "Answers"; "Explanations"). The app tells the two apart by itself.'));
  }

  const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

  async function start(files) {
    if (files.length > 1) return runBatch(files);
    const file = files[0];
    if (!isPdf(file)) {
      root.replaceChildren(chooser(refusalBox(['This is not a PDF file. Please choose a .pdf file.'])));
      return;
    }
    const status = h('p', { class: 'progress-step' }, 'Opening the PDF…');
    const bar = h('progress', { max: 100, value: 0 });
    const t0 = Date.now();
    const elapsed = h('p', { class: 'muted small' }, '');
    const timer = setInterval(() => { elapsed.textContent = `${Math.round((Date.now() - t0) / 1000)} seconds`; }, 500);
    root.replaceChildren(h('div', { class: 'page narrow' },
      h('h1', null, 'Reading the PDF'),
      h('p', null, file.name),
      status, bar, elapsed,
      h('p', { class: 'muted small' }, 'This usually takes 10–60 seconds. Please keep this page open.')));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const existing = await getSource(sourceIdFromSha(await sha256Hex(bytes)));
      if (existing) {
        root.replaceChildren(chooser(refusalBox([`This PDF is already in your library as "${existing.name}". It was not added again.`])));
        return;
      }
      const onProgress = ({ step, done, total }) => { status.textContent = step; if (total) bar.value = Math.round((done / total) * 100); };
      status.textContent = 'Checking what kind of PDF this is…';
      const format = await detectPdfFormat(bytes);
      if (format === 'mock') {
        const draft = await parseMock(bytes, { fileName: file.name, onProgress });
        if (draft.structuralErrors.length) { root.replaceChildren(chooser(refusalBox(draft.structuralErrors, 'mock'))); return; }
        await renderMockReview(root, draft, { bag, setUnsaved: (v) => { unsaved = v; } });
        return;
      }
      const draft = await parsePdf(bytes, { fileName: file.name, onProgress });
      if (draft.structuralErrors.length) {
        root.replaceChildren(chooser(refusalBox(draft.structuralErrors)));
        return;
      }
      await review(draft);
    } catch (err) {
      console.error(err);
      root.replaceChildren(chooser(refusalBox([
        'Something went wrong while reading this PDF. Nothing was saved.',
        `Technical details: ${err && err.message ? err.message : err}`,
      ])));
    } finally {
      clearInterval(timer);
    }
  }

  // ---------- many PDFs at once ----------
  async function runBatch(files) {
    unsaved = true;
    const defaults = await getDefaults();
    const rows = files.map((file) => ({ file, status: 'waiting', note: '', el: null }));
    const listEl = h('ol', { class: 'batch-list', id: 'batch-list' });
    const drawRow = (r) => {
      const cls = { waiting: 'muted', reading: '', saved: 'ok', check: 'warn', refused: 'error', duplicate: 'muted' }[r.status] || '';
      const label = { waiting: 'waiting', reading: 'reading…', saved: 'saved', check: 'needs your check', refused: 'refused', duplicate: 'already in the library' }[r.status];
      const el = h('li', { class: `batch-row ${cls}`, dataset: { status: r.status } },
        h('span', { class: 'batch-name' }, r.file.name), ' — ', h('strong', null, label), r.note ? h('span', { class: 'small' }, ` (${r.note})`) : null);
      if (r.el) r.el.replaceWith(el); else listEl.append(el);
      r.el = el;
    };
    rows.forEach(drawRow);
    const overall = h('progress', { max: files.length, value: 0, id: 'batch-progress' });
    const status = h('p', { class: 'progress-step', id: 'batch-status' }, 'Starting…');
    const fileBar = h('progress', { max: 100, value: 0 });
    let stop = false;
    const stopBtn = h('button', { class: 'btn', type: 'button', onClick: () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping after this file…'; } }, 'Stop after this file');
    root.replaceChildren(h('div', { class: 'page narrow' },
      h('h1', null, `Reading ${files.length} PDFs`),
      h('p', { class: 'muted small' }, 'Please keep this page open. Each PDF takes about 10–60 seconds. PDFs that read cleanly are saved as you wait; the doubtful ones are shown to you afterwards, one by one.'),
      status, fileBar, overall, h('p', null, stopBtn), listEl));

    const toCheck = [];
    const saved = [];
    for (let i = 0; i < rows.length; i++) {
      if (stop) break;
      const r = rows[i];
      overall.value = i;
      status.textContent = `File ${i + 1} of ${files.length}: ${r.file.name}`;
      fileBar.value = 0;
      r.status = 'reading'; drawRow(r);
      try {
        if (!isPdf(r.file)) { r.status = 'refused'; r.note = 'not a PDF file'; drawRow(r); continue; }
        const bytes = new Uint8Array(await r.file.arrayBuffer());
        const existing = await getSource(sourceIdFromSha(await sha256Hex(bytes)));
        if (existing) { r.status = 'duplicate'; r.note = `as "${existing.name}"`; drawRow(r); continue; }
        const onProgress = ({ step, done, total }) => { status.textContent = `File ${i + 1} of ${files.length}: ${r.file.name} — ${step}`; if (total) fileBar.value = Math.round((done / total) * 100); };
        if (await detectPdfFormat(bytes) === 'mock') {
          const md = await parseMock(bytes, { fileName: r.file.name, onProgress });
          if (md.structuralErrors.length) { r.status = 'refused'; r.note = md.structuralErrors[0]; r.reasons = md.structuralErrors; drawRow(r); continue; }
          r.status = 'check'; r.note = 'mock test: the answer key needs your approval'; r.draft = md; r.mock = true; r.doubts = ['This is a full mock test; its answer key is approved by you, never automatically.', ...md.report.warnings.slice(0, 5)]; toCheck.push(r); drawRow(r); continue;
        }
        const draft = await parsePdf(bytes, { fileName: r.file.name, onProgress });
        if (draft.structuralErrors.length) { r.status = 'refused'; r.note = draft.structuralErrors[0]; r.reasons = draft.structuralErrors; drawRow(r); continue; }
        const doubts = batchDoubts(draft);
        if (doubts.length) { r.status = 'check'; r.note = doubts[0]; r.draft = draft; r.doubts = doubts; toCheck.push(r); drawRow(r); continue; }
        // no doubts at all: save with the key approved (the test page shows every key strip for spot checks)
        const c = classifyTopic(draft.header.subject, draft.file.name, draft.header.topic);
        const form = { subject: draft.header.subject, topic: draft.header.topic, area: c.area, chapter: c.chapter, name: draft.header.name || '', timeLimitMin: defaults.timeLimitMin, marking: structuredClone(defaults.marking) };
        const now = new Date().toISOString();
        const records = buildRecords(draft, form, now, now);
        records.source.keyApproval.auto = true; // approved by the batch: every answer was read clearly from the text layer
        await saveImport(records);
        import('../sync/account.js').then((m) => m.syncSoon()).catch(() => {});
        r.status = 'saved'; r.note = `${draft.questions.length} questions`; r.testId = records.test.id; r.testName = records.test.name; saved.push(r); drawRow(r);
      } catch (err) {
        console.error(err);
        r.status = 'refused'; r.note = `could not be read (${err && err.message ? err.message : err})`; drawRow(r);
      }
    }
    overall.value = rows.filter((r) => r.status !== 'waiting').length;
    unsaved = toCheck.length > 0;
    summary();

    function summary() {
      const refused = rows.filter((r) => r.status === 'refused');
      const dup = rows.filter((r) => r.status === 'duplicate');
      const notDone = rows.filter((r) => r.status === 'waiting');
      const pending = toCheck.filter((r) => r.status === 'check');
      root.replaceChildren(h('div', { class: 'page narrow' },
        h('h1', null, 'PDFs read'),
        h('section', { class: 'card', id: 'batch-summary' },
          h('ul', null,
            h('li', null, h('strong', null, `${saved.length} saved`), saved.length ? [' — ', ...saved.flatMap((r, k) => [k ? ', ' : null, h('a', { href: `#/test/${r.testId}` }, r.testName)])] : ''),
            h('li', null, h('strong', null, `${pending.length} need your check`), pending.length ? ' — the app had a doubt about each of these; you will see why on each review page.' : ''),
            h('li', null, h('strong', null, `${dup.length} already in the library`), dup.length ? ` — ${dup.map((r) => r.file.name).join(', ')}` : ''),
            h('li', null, h('strong', null, `${refused.length} refused`)),
            notDone.length ? h('li', null, h('strong', null, `${notDone.length} not read`), ' (stopped)') : null),
          refused.length ? h('div', { class: 'box box-error' }, h('h3', null, 'Refused'), h('ul', null, refused.map((r) => h('li', null, h('strong', null, r.file.name), ': ', (r.reasons || [r.note]).join(' '))))) : null,
          pending.length
            ? h('button', { class: 'btn btn-primary', type: 'button', id: 'check-next', onClick: () => checkNext() }, `Check the first one (${pending[0].file.name})`)
            : h('a', { class: 'btn btn-primary', href: '#/library' }, 'Go to the library')),
        listEl));
    }

    function checkNext() {
      const pending = toCheck.filter((r) => r.status === 'check');
      if (!pending.length) { unsaved = false; summary(); return; }
      const r = pending[0];
      const index = toCheck.length - pending.length + 1;
      const batchArgs = {
        index, total: toCheck.length, reasons: r.doubts,
        onDone: (result, test) => {
          r.draft = null;
          if (result === 'saved') { r.status = 'saved'; r.note = `${test.sections[0].questionIds.length} questions`; r.testId = test.id; r.testName = test.name; saved.push(r); }
          else { r.status = 'refused'; r.note = 'discarded by you'; r.reasons = ['You discarded it on the review page.']; }
          drawRow(r);
          unsaved = toCheck.some((x) => x.status === 'check');
          checkNext();
        },
      };
      if (r.mock) renderMockReview(root, r.draft, { bag, setUnsaved: (v) => { unsaved = v; }, batch: batchArgs });
      else review(r.draft, batchArgs);
    }
  }

  /** Why a parsed PDF still needs the user's eyes (empty list = clean). */
  function batchDoubts(draft) {
    const reasons = [];
    const rep = validateDraft(draft);
    reasons.push(...rep.errors, ...rep.warnings);
    if (draft.kind !== 'text') reasons.push('This PDF has no text layer: the answer key was read by matching shapes, so please compare it with the key pictures.');
    const unclear = draft.questions.filter((q) => !q.answer.readClearly);
    if (unclear.length) reasons.push(`The answer of Q${unclear.map((q) => q.n).join(', Q')} was not read clearly.`);
    const flagged = draft.questions.filter((q) => (q.issues || []).length);
    if (flagged.length) reasons.push(`Q${flagged.map((q) => q.n).join(', Q')} have notes from the reader.`);
    if (draft.warnings && draft.warnings.length) reasons.push(...draft.warnings);
    if (!draft.header.subject || !draft.header.topic) reasons.push('The subject or the topic could not be read from the PDF.');
    else {
      const c = classifyTopic(draft.header.subject, draft.file.name, draft.header.topic);
      if (!c.area || !c.chapter) reasons.push('The topic / sub-topic could not be worked out from the file name or heading.');
    }
    return [...new Set(reasons)];
  }

  function refusalBox(reasons, what = 'DPP') {
    return h('div', { class: 'box box-error', role: 'alert' },
      h('h2', null, what === 'mock' ? 'This mock PDF was refused' : 'This PDF was refused'),
      h('p', null, 'Nothing was saved. Reasons:'),
      h('ul', null, reasons.map((r) => h('li', null, r))),
      h('p', { class: 'small' }, 'If this PDF is a normal DPP from your institute, please keep it and tell Claude, so the reader can be improved.'));
  }

  async function review(draft, batch = null) {
    unsaved = true;
    const defaults = await getDefaults();
    const topics = [...new Set((await listSources()).map((s) => s.topic).filter(Boolean))].sort();
    const pic = (id) => (id && draft.images[id] ? { src: bag.url(draft.images[id].blob), width: draft.images[id].width, height: draft.images[id].height } : null);
    const form = {
      subject: draft.header.subject || '',
      topic: draft.header.topic || '',
      area: '',
      chapter: '',
      name: draft.header.name || '',
      timeLimitMin: defaults.timeLimitMin,
      marking: structuredClone(defaults.marking),
    };
    let approved = false;
    let onlyFlagged = false;
    let areaByUser = false;
    let chapterByUser = false;
    const autoTopic = () => {
      const c = classifyTopic(form.subject, draft.file.name, form.topic);
      if (!areaByUser) form.area = c.area;
      if (!chapterByUser) form.chapter = c.chapter;
    };
    autoTopic();

    const reportBox = h('section', { class: 'card' });
    const saveBar = h('div', { class: 'savebar' });
    const cardsBox = h('div', { class: 'cards' });

    const effective = () => ({ ...draft, header: { ...draft.header, subject: form.subject || null, topic: form.topic } });
    const refresh = () => {
      const rep = validateDraft(effective());
      const sProblems = settingsProblems(form);
      if (form.subject && !form.area) sProblems.push('Choose the topic (for example Arithmetic, RC or DI).');
      if (form.subject && !form.chapter.trim()) sProblems.push('Type the sub-topic (for example Percentage).');
      renderReport(rep, sProblems);
      renderSaveBar(rep, sProblems);
    };

    function renderReport(rep, sProblems) {
      const toDo = [...rep.errors, ...sProblems];
      fill(reportBox,
        h('h2', null, 'Validation report'),
        h('table', { class: 'report' }, h('tbody', null, rep.checks.map((c) => h('tr', { class: c.ok ? 'ok' : 'bad' },
          h('td', { class: 'mark' }, c.ok ? '✓' : '!'), h('td', null, c.label), h('td', null, c.detail))))),
        h('p', { class: 'muted small' },
          `PDF: ${draft.file.name} · ${draft.file.pages} pages · `,
          draft.kind === 'text' ? 'has a text layer (labels read from it)' : 'no text layer (labels read by their shapes)',
          ` · read in ${Math.round(draft.timings.totalMs / 1000)} s`),
        toDo.length ? h('div', { class: 'box box-error' }, h('h3', null, 'To do before saving'), h('ul', null, toDo.map((e) => h('li', null, e)))) : null,
        rep.warnings.length ? h('div', { class: 'box box-warn' }, h('h3', null, 'Please check'), h('ul', null, rep.warnings.map((w) => h('li', null, w)))) : null,
      );
    }

    function renderSaveBar(rep, sProblems) {
      const blockers = rep.errors.length + sProblems.length;
      const checkbox = h('input', { type: 'checkbox', id: 'approve-key', checked: approved });
      checkbox.addEventListener('change', () => { approved = checkbox.checked; refresh(); });
      const canSave = blockers === 0 && approved;
      fill(saveBar,
        h('label', { class: 'approve', for: 'approve-key' }, checkbox,
          ` I have compared all ${draft.questions.length} answers with the answer-key pictures and approve this answer key.`),
        h('div', { class: 'savebar-row' },
          h('span', { class: blockers ? 'error' : 'muted' },
            blockers ? `${blockers} thing(s) to fix first (see the report at the top).` : approved ? 'Ready to save.' : 'Tick the box to approve the answer key.'),
          h('button', { class: 'btn', type: 'button', onClick: async () => {
            if (await confirmDialog({ title: 'Discard this PDF?', message: 'Nothing will be saved.', okText: 'Discard', cancelText: 'Keep checking' })) {
              unsaved = false;
              bag.free();
              if (batch) { batch.onDone('discarded'); return; }
              root.replaceChildren(chooser());
            }
          } }, 'Discard'),
          h('button', { class: 'btn btn-primary', type: 'button', disabled: !canSave, id: 'save-test', onClick: save }, 'Save test')));
    }

    async function save() {
      try {
        const now = new Date().toISOString();
        const records = buildRecords(draft, form, now, now);
        await saveImport(records);
        import('../sync/account.js').then((m) => m.syncSoon()).catch(() => {});
        const { test } = records;
        unsaved = false;
        bag.free();
        if (batch) { batch.onDone('saved', test); return; }
        location.hash = `#/test/${test.id}?saved=1`;
      } catch (err) {
        console.error(err);
        await confirmDialog({ title: 'The test was not saved', message: [String(err && err.message ? err.message : err)], okText: 'OK', cancelText: 'Close' });
      }
    }

    // details form
    const field = (label, control, hint) => h('label', { class: 'field' }, h('span', null, label), control, hint ? h('span', { class: 'muted small' }, hint) : null);
    const subjectSel = h('select', { id: 'subject' }, h('option', { value: '' }, '— choose —'), SUBJECTS.map((s) => h('option', { value: s, selected: s === form.subject }, s)));
    subjectSel.addEventListener('change', () => { form.subject = subjectSel.value; areaByUser = false; chapterByUser = false; autoTopic(); drawTopicFields(); refresh(); });
    const topicIn = h('input', { type: 'text', id: 'topic', value: form.topic, list: 'topic-list', placeholder: 'e.g. Percentage 1' });
    topicIn.addEventListener('input', () => {
      const autoName = !form.name || form.name === draft.header.name;
      form.topic = topicIn.value;
      autoTopic();
      drawTopicFields();
      if (autoName) { form.name = form.topic + (draft.header.dpp ? ` – DPP ${draft.header.dpp}` : ''); nameIn.value = form.name; draft.header.name = form.name; }
      refresh();
    });
    const areaSel = h('select', { id: 'area' });
    areaSel.addEventListener('change', () => { form.area = areaSel.value; areaByUser = true; drawTopicFields(); refresh(); });
    const chapterIn = h('input', { type: 'text', id: 'chapter', list: 'chapter-list', placeholder: 'e.g. Percentage' });
    chapterIn.addEventListener('input', () => { form.chapter = chapterIn.value; chapterByUser = true; refresh(); });
    const chapterList = h('datalist', { id: 'chapter-list' });
    function drawTopicFields() {
      areaSel.replaceChildren(h('option', { value: '' }, form.subject ? '— choose —' : '— choose the subject first —'),
        ...areasOf(form.subject).map((a) => h('option', { value: a, selected: a === form.area }, AREA_LONG[a] ? `${a} (${AREA_LONG[a]})` : a)));
      areaSel.value = form.area;
      if (document.activeElement !== chapterIn) chapterIn.value = form.chapter;
      chapterList.replaceChildren(...chaptersOf(form.area).map((c) => h('option', { value: c })));
    }
    drawTopicFields();
    const nameIn = h('input', { type: 'text', id: 'test-name', value: form.name });
    nameIn.addEventListener('input', () => { form.name = nameIn.value; });
    const num = (value, onChange, attrs = {}) => {
      const el = h('input', { type: 'number', value: String(value), step: 'any', class: 'num', ...attrs });
      el.addEventListener('input', () => { onChange(el.value); refresh(); });
      return el;
    };
    const details = h('section', { class: 'card' },
      h('h2', null, 'Test details'),
      draft.header.image ? h('div', null, h('p', { class: 'muted small' }, 'Heading of the PDF:'), picture(pic(draft.header.image).src, { ...pic(draft.header.image), alt: 'PDF heading', scale: 0.45 })) : h('p', { class: 'muted' }, 'No heading picture found.'),
      h('p', { class: 'muted small' }, draft.header.source
        ? `Filled in from the ${draft.header.source}. Please check.`
        : 'The app cannot read words from this kind of PDF. Please choose the subject and type the topic shown in the heading above.'),
      h('div', { class: 'form-grid' },
        field('Subject', subjectSel),
        field('Heading (as in the PDF)', topicIn, 'The name printed in the PDF heading, e.g. Percentage 1.'),
        field('Topic', areaSel, 'Filled in from the file name or the heading. Please check.'),
        field('Sub-topic', chapterIn, 'Used for the library filter, sectional tests and accuracy by sub-topic.'),
        field('Test name', nameIn),
        field('Time limit (minutes)', num(form.timeLimitMin, (v) => { form.timeLimitMin = v; }, { min: 1, max: 600, step: 1, id: 'time-limit' }))),
      h('h3', null, 'Marks for this test'),
      h('div', { class: 'form-grid' },
        field('MCQ correct', num(form.marking.mcq.correct, (v) => { form.marking.mcq.correct = v; })),
        field('MCQ wrong', num(form.marking.mcq.wrong, (v) => { form.marking.mcq.wrong = v; })),
        field('TITA correct', num(form.marking.tita.correct, (v) => { form.marking.tita.correct = v; })),
        field('TITA wrong', num(form.marking.tita.wrong, (v) => { form.marking.tita.wrong = v; }))),
      h('datalist', { id: 'topic-list' }, topics.map((t) => h('option', { value: t }))),
      chapterList);

    // question cards
  const setLabels = new Map();
  for (const q of draft.questions) {
    if (!q.setId) continue;
    const l = setLabels.get(q.setId);
    setLabels.set(q.setId, l ? { from: l.from, to: q.n } : { from: q.n, to: q.n });
  }
  const setLabel = (q) => (q.setId && setLabels.get(q.setId) ? `Q${setLabels.get(q.setId).from}–Q${setLabels.get(q.setId).to}` : null);
    const cards = draft.questions.map((q) => {
      const notes = (q.issues || []).map((i) => i.text);
      const vm = {
        n: q.n, answer: q.answer, optionsMode: q.optionsMode, stemHeight: q.stemHeight, markersFound: q.markersFound, notes,
        setId: q.setId, setLabel: setLabel(q),
        pics: {
          question: pic(q.images.question),
          options: q.images.options ? Object.fromEntries(Object.entries(q.images.options).map(([L, id]) => [L, pic(id)])) : null,
          solution: pic(q.images.solution),
          keyStrip: pic(q.images.keyStrip),
          passage: pic(q.images.passage),
        },
      };
      return questionCard(vm, {
        onAnswer: (value) => {
          const v = String(value ?? '').trim();
          q.answer.value = answerKind(v) === 'MCQ' ? v.toUpperCase() : v;
          q.answer.edited = q.answer.value !== (q.answer.detected ?? '');
          if (approved) approved = false; // any change needs a fresh approval
          refresh();
        },
      });
    });
    cardsBox.replaceChildren(...cards);
    const filterBox = h('input', { type: 'checkbox', id: 'only-flagged' });
    filterBox.addEventListener('change', () => {
      onlyFlagged = filterBox.checked;
      for (const c of cards) c.hidden = onlyFlagged && c.dataset.flagged !== 'yes';
    });

    root.replaceChildren(h('div', { class: 'page' },
      h('h1', null, batch ? `Check ${batch.index} of ${batch.total}: ${draft.file.name}` : 'Check this test before saving'),
      h('p', null, 'Nothing is saved until you approve the answer key and press "Save test" at the bottom.'),
      batch ? h('div', { class: 'box box-warn', id: 'batch-reasons' }, h('h3', null, 'Why the app is asking you about this PDF'), h('ul', null, batch.reasons.map((x) => h('li', null, x)))) : null,
      reportBox,
      details,
      h('section', { class: 'card' },
        h('h2', null, 'Answer key and pictures'),
        h('p', null, 'For every question, compare the answer the app read with the answer-key picture next to it. If one is wrong, click the right letter or type the number — it will be marked "edited by me". Click any picture to enlarge it.'),
        h('label', { class: 'inline' }, filterBox, ' Show only flagged or edited questions'),
        cardsBox),
      saveBar));
    refresh();
  }

  return {
    canLeave: async () => !unsaved || confirmDialog({ title: 'Leave without saving?', message: 'The PDF you are checking has not been saved.', okText: 'Leave', cancelText: 'Stay' }),
    cleanup: () => bag.free(),
    hasUnsaved: () => unsaved,
  };
}
