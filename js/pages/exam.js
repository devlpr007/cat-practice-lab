// The test screen (#/exam/<testId>). Plain and fast: no animations.
// Style A (Quant): one question pane. Style B (VARC/LRDI): passage left, question right.
// Answers are kept as soon as they are chosen; "Next" moves on. The timer uses an absolute end
// time; the attempt is autosaved every few seconds and resumed exactly where it was left.
import { topicHref } from '../topics.js';
import { h, fill, UrlBag, showPicture, confirmDialog } from '../ui.js';
import {
  getTest, getQuestions, getImagesForSources, getInProgressAttempt, putAttempt,
  saveSubmittedAttempt, discardAttempt, getSetting,
} from '../db.js';
import {
  createAttempt, openQuestion, setAnswer, toggleMark, tick, resumeClock, statusOf, counts,
  timerText, totalTimeText, clockStopped, isTimeUp, finish, questionAttemptRecords, checkQuestion, setNote, STATUS,
  currentSection, openRange, nextSection, syncSections, sectionCounts, isSectionTimeUp,
} from '../exam/engine.js';
import { isCorrect } from '../exam/scoring.js';
import { computeResult, scoredRecords } from '../results.js';
import { newCalc, press, usableValue } from '../exam/calc.js';
import { testQuestionIds } from '../model.js';

const AUTOSAVE_MS = 4000;
/** What the calculator's "Erase" button does (user's choice: clear the typed-answer box). */
const ERASE_CLEARS_TYPED_ANSWER = true;

const PRACTICE_LEGEND = [
  [STATUS.CORRECT, 'Correct', 'correct'],
  [STATUS.INCORRECT, 'Incorrect', 'incorrect'],
];
const LEGEND = [
  [STATUS.ANSWERED, 'Answered', 'answered'],
  [STATUS.NOT_ANSWERED, 'Not answered', 'notAnswered'],
  [STATUS.MARKED, 'Marked for review', 'marked'],
  [STATUS.ANSWERED_MARKED, 'Answered & marked', 'answeredMarked'],
  [STATUS.NOT_VISITED, 'Not visited', 'notVisited'],
];

const ICON = {
  back: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 13V9M10 3h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" fill="currentColor" fill-opacity="var(--fill,0)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  calc: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 7h8M8.5 12h1M12 12h1M15 12h1M8.5 16h1M12 16h1M15 16h1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
const icon = (name) => { const s = document.createElement('span'); s.className = 'icon'; s.innerHTML = ICON[name]; return s; };

export async function render(root, params) {
  const bag = new UrlBag();
  const test = await getTest(params.id);
  if (!test) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', null, 'Test not found'), h('p', null, h('a', { href: '#/library' }, 'Back to the library'))));
    return { cleanup: () => bag.free() };
  }
  const questions = await getQuestions(testQuestionIds(test));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const notApproved = questions.filter((q) => !q.keyApprovedAt);
  let attempt = await getInProgressAttempt(test.id);
  let timers = [];
  const stopTimers = () => { timers.forEach(clearInterval); timers = []; };
  const cleanupAll = () => { stopTimers(); document.body.classList.remove('in-exam'); bag.free(); };

  if (notApproved.length) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('div', { class: 'box box-error' },
      h('h2', null, 'This test cannot be taken yet'),
      h('p', null, `${notApproved.length} question(s) have an answer key you have not approved. Open the test, check the key and approve it first.`))));
    return { cleanup: cleanupAll };
  }

  // ---------- start screen ----------
  if (!attempt && test.kind === 'mock') {
    const m = test.settings.marking;
    const secs = test.sections;
    root.replaceChildren(h('div', { class: 'page narrow' },
      h('h1', null, test.name),
      h('section', { class: 'card' },
        h('h2', null, 'Instructions'),
        h('ul', null,
          h('li', null, `${questions.length} questions in ${secs.length} sections, in this order: ${secs.map((x) => `${x.name} (${x.questionIds.length} questions, ${x.timeLimitMin} min)`).join(' → ')}. Total ${test.settings.timeLimitMin} minutes.`),
          h('li', null, 'Each section has its own clock. When it runs out, the next section starts at once. You can also submit a section early; its unused time is lost.'),
          h('li', null, 'You cannot go back to a finished section, and you cannot look ahead.'),
          h('li', null, `Marks: MCQ +${m.mcq.correct} / ${m.mcq.wrong}, typed answer (TITA) +${m.tita.correct} / ${m.tita.wrong}. Marked-for-review answers are still scored.`),
          h('li', null, 'The clock keeps running if you refresh, lock the phone or leave the page (the real exam cannot be paused).'),
          h('li', null, 'Solutions and your score are shown only after the last section.')),
        h('button', { class: 'btn btn-primary', type: 'button', id: 'start-test', onClick: async () => {
          const now = Date.now();
          attempt = createAttempt({ id: `at-${now.toString(36)}`, test, now, timerDirection: 'down' });
          await putAttempt(attempt);
          startExam();
        } }, 'Start mock'),
        ' ',
        h('a', { class: 'btn', href: '#/library/mock' }, 'Back'))));
    return { cleanup: cleanupAll };
  }
  if (!attempt) {
    const dir = await getSetting('timerDirection', 'down');
    const m = test.settings.marking;
    const dirSel = h('select', { id: 'timer-direction' },
      h('option', { value: 'down', selected: dir === 'down' }, 'Exam mode'),
      h('option', { value: 'up', selected: dir === 'up' }, 'Practice mode'));
    const modeNote = h('p', { class: 'box small', id: 'mode-note' });
    const explain = () => {
      modeNote.textContent = dirSel.value === 'up'
        ? 'Practice mode: each question has its own clock counting up. It runs while you are on that question and stops when you press "Submit question", which locks your answer, shows the solution and colours the question green (correct) or red (wrong). If you leave a question without submitting it, its clock carries on when you come back to it.'
        : 'Exam mode: like the real exam. The clock counts down the time left for the whole test. Solutions and correct / wrong colours are shown only after you submit the whole test.';
    };
    dirSel.addEventListener('change', explain);
    explain();
    root.replaceChildren(h('div', { class: 'page narrow' },
      h('h1', null, test.name),
      h('section', { class: 'card' },
        h('h2', null, 'Instructions'),
        h('ul', null,
          h('li', null, `${questions.length} questions · ${test.settings.timeLimitMin} minutes. The test is submitted automatically when the time is up.`),
          h('li', null, `Marks: MCQ +${m.mcq.correct} / ${m.mcq.wrong}, typed answer (TITA) +${m.tita.correct} / ${m.tita.wrong}.`),
          h('li', null, 'Your answer is kept as soon as you choose it. "Next" moves to the next question.'),
          h('li', null, 'The bookmark marks a question for review. Marked questions are still scored.'),
          h('li', null, 'The timer keeps running if you refresh, lock the phone or leave the page; you can come back and continue.')),
        h('label', { class: 'field' }, h('span', null, 'Mode'), dirSel),
        modeNote,
        h('button', { class: 'btn btn-primary', type: 'button', id: 'start-test', onClick: async () => {
          const now = Date.now();
          attempt = createAttempt({ id: `at-${now.toString(36)}`, test, now, timerDirection: dirSel.value });
          await putAttempt(attempt);
          startExam();
        } }, 'Start test'),
        ' ',
        h('a', { class: 'btn', href: test.kind === 'custom' ? '#/sectional' : '#/library' }, 'Back'))));
    return { cleanup: cleanupAll };
  }
  return startExam();

  // ---------- the exam ----------
  function startExam() {
    const images = { map: null };
    let submitting = false;
    const isMock = !!attempt.mock;
    if (isMock) syncSections(attempt, Date.now());
    if (attempt.status !== 'in-progress') { finishAfterCatchUp(); return { cleanup: cleanupAll }; }
    let sectionNotice = null; // "Time is up for VARC — DILR has started"
    const secTabs = h('div', { class: 'section-tabs', id: 'section-tabs', role: 'tablist' });
    const style = (test.sections.find((s) => s.questionIds.includes(attempt.questions[attempt.current].questionId)) || test.sections[0]).style;
    document.body.classList.add('in-exam');
    let visible = document.visibilityState !== 'hidden';
    let dirty = false;
    let calc = null;
    let noteOpen = false;
    let drawerOpen = false;
    let sideCollapsed = false;
    let phoneTab = 'question';

    const practice = attempt.mode === 'practice';
    const timerEl = h('span', { class: 'timer-text', id: 'timer' });
    const timerLabel = practice ? h('span', { class: 'timer-label', id: 'timer-label' }) : null;
    const totalEl = practice ? h('span', { class: 'timer-total', id: 'timer-total' }) : null;
    const top = h('header', { class: 'exam-top' },
      h('button', { class: 'btn-plain back', type: 'button', id: 'exam-back', onClick: leave }, icon('back'), 'Back'),
      practice
        ? h('div', { class: 'timer practice-timer' }, h('div', { class: 'timer-main' }, icon('clock'), timerLabel, timerEl), totalEl)
        : h('div', { class: 'timer' }, icon('clock'), timerEl),
      h('div', { class: 'top-right' },
        h('button', { class: 'btn-plain palette-toggle', type: 'button', id: 'palette-toggle', 'aria-label': 'Show questions', onClick: () => { drawerOpen = !drawerOpen; draw(); } }, icon('grid')),
        h('button', { class: 'btn-outline', type: 'button', id: 'submit-test', onClick: askSubmit }, isMock ? 'Submit section' : 'Submit')));
    const main = h('main', { class: 'exam-main' });
    const side = h('aside', { class: 'exam-side', id: 'palette' });
    const collapse = h('button', { class: 'collapse-btn', type: 'button', 'aria-label': 'Hide or show the question palette', onClick: () => { sideCollapsed = !sideCollapsed; draw(); } });
    const body = h('div', { class: 'exam-body' }, main, collapse, side);
    const calcBox = h('div', { class: 'calc', id: 'calculator', hidden: true });
    const screen = h('div', { class: `exam style-${style}` + (isMock ? ' mock' : '') }, top, isMock ? secTabs : null, body, calcBox);
    root.replaceChildren(screen);

    const save = async () => { if (attempt.status === 'in-progress') { dirty = false; await putAttempt(attempt); } };
    const changed = () => { dirty = true; draw(); };
    const go = (index) => { openQuestion(attempt, index, Date.now()); noteOpen = false; phoneTab = 'question'; changed(); main.scrollTop = 0; save(); };

    const pic = (id) => {
      const im = id && images.map && images.map.get(id);
      return im ? { src: bag.url(im.blob), width: im.width, height: im.height } : null;
    };
    const imgEl = (p, alt, scale = 0.6, zoom = true) => {
      if (!p) return h('p', { class: 'error' }, 'Picture missing.');
      const el = h('img', { src: p.src, alt, class: 'exam-img' + (zoom ? '' : ' no-zoom'), width: Math.round(p.width * scale), height: Math.round(p.height * scale) });
      if (zoom) el.addEventListener('click', () => showPicture(p.src, alt));
      return el;
    };
    const stemEl = (q, p) => {
      if (!p) return h('p', { class: 'error' }, 'Picture missing.');
      if (!(q.optionsMode === 'separate' && q.stemHeight)) return imgEl(p, `Question ${q.n}`);
      const w = Math.round(p.width * 0.6);
      const wrap = h('div', { class: 'clip exam-img', style: { width: `${w}px`, maxWidth: '100%', aspectRatio: `${p.width} / ${q.stemHeight}` } },
        h('img', { src: p.src, alt: `Question ${q.n}`, style: { width: '100%', height: 'auto' } }));
      wrap.addEventListener('click', () => showPicture(p.src, `Question ${q.n}`));
      return wrap;
    };

    function setLabel(qIndex) {
      const q = byId.get(attempt.questions[qIndex].questionId);
      if (!q || !q.setId) return null;
      const nums = attempt.questions.map((x, i) => [i, byId.get(x.questionId)]).filter(([, y]) => y && y.setId === q.setId).map(([i]) => i + 1);
      return `Answer Qs. ${nums[0]}–${nums[nums.length - 1]} based on the passage`;
    }

    function questionPane({ passageAbove = false } = {}) {
      const a = attempt.questions[attempt.current];
      const q = byId.get(a.questionId);
      const p = q.images;
      const marked = a.marked;
      const pane = h('section', { class: 'question-pane' },
        h('div', { class: 'q-head' },
          h('span', { class: 'q-num', id: 'q-number' }, String(attempt.current + 1)),
          h('span', { class: 'q-type' }, q.type === 'TITA' ? 'Type your answer' : ''),
          h('span', { class: 'spacer' }),
          h('span', { class: 'mark-wrap' },
            h('button', {
              class: 'icon-btn' + (marked ? ' on' : '') + (a.note ? ' has-note' : ''), type: 'button', id: 'mark-review', 'aria-pressed': String(marked),
              title: marked ? 'Marked for review — click for your note or to remove the mark' : 'Mark for review',
              onClick: () => {
                if (!a.marked) { toggleMark(attempt); save(); }
                noteOpen = true;
                changed();
              },
            }, icon('bookmark')),
            noteOpen ? noteBox(a) : null),
          h('button', { class: 'icon-btn', type: 'button', id: 'open-calc', title: 'Calculator', onClick: () => { calc = calc || newCalc(); calcBox.hidden = false; drawCalc(); } }, icon('calc'))));
      // question on the left, answer on the right when the screen is wide enough; otherwise the
      // answer simply wraps below the question (phones, wide pictures)
      const qCol = h('div', { class: 'q-col' },
        passageAbove ? h('div', { class: 'passage-above', id: 'passage' }, h('div', { class: 'set-title' }, setLabel(attempt.current) || ''), imgEl(pic(p.passage), 'Passage', 0.6)) : null,
        h('div', { class: 'q-body' }, stemEl(q, pic(p.question))));
      const aCol = h('div', { class: 'a-col' });
      pane.append(h('div', { class: 'qa' }, qCol, aCol));
      const locked = !!a.checked;
      if (q.type === 'MCQ') {
        const letters = ['A', 'B', 'C', 'D'];
        const rows = letters.map((L, i) => {
          const chosen = a.answer === L;
          let cls = 'opt' + (chosen ? ' chosen' : '');
          if (locked && chosen) cls += a.checked.correct ? ' right' : ' wrong';
          if (locked && !a.checked.correct && q.answer === L) cls += ' key';
          const content = q.optionsMode === 'separate' && p.options ? imgEl(pic(p.options[L]), `Option ${i + 1}`, 0.6, false) : h('span', { class: 'muted' }, `Option ${i + 1} (see the question picture)`);
          return h('button', {
            class: cls, type: 'button', role: 'radio', 'aria-checked': String(chosen), id: `opt-${i + 1}`, disabled: locked,
            onClick: () => { setAnswer(attempt, L, Date.now()); changed(); save(); },
          }, h('span', { class: 'opt-n' }, String(i + 1)), h('span', { class: 'opt-body' }, content), h('span', { class: 'radio' + (chosen ? ' on' : '') }));
        });
        aCol.append(h('div', { class: 'options', role: 'radiogroup' }, rows));
      } else {
        aCol.append(titaBox(a, locked));
      }
      if (!locked) aCol.append(h('button', { class: 'link-btn', type: 'button', id: 'clear-response', onClick: () => { setAnswer(attempt, null, Date.now()); changed(); save(); } }, 'Clear response'));
      if (attempt.mode === 'practice') {
        if (!locked) {
          aCol.append(h('div', { class: 'practice-row' }, h('button', {
            class: 'btn-outline', type: 'button', id: 'submit-question', disabled: a.answer === null,
            title: a.answer === null ? 'Choose or type an answer first' : 'Check this answer and see the solution',
            onClick: async () => {
              // the answer is locked: store it before showing the result, so a refresh cannot lose it
              checkQuestion(attempt, Date.now(), isCorrect(q.type, a.answer, q.answer));
              await save();
              changed();
            },
          }, 'Submit question')));
        } else {
          const keyText = q.type === 'MCQ' ? `option ${'ABCD'.indexOf(q.answer) + 1}` : q.answer;
          aCol.append(h('div', { class: `result ${a.checked.correct ? 'ok' : 'bad'}`, id: 'result', role: 'status' },
            a.checked.correct ? 'Correct' : `Incorrect — the correct answer is ${keyText}`));
          pane.append(h('div', { class: 'solution', id: 'solution' }, h('h3', null, 'Solution'), imgEl(pic(p.solution), `Solution ${attempt.current + 1}`)));
        }
      }
      return pane;
    }

    function noteBox(a) {
      const area = h('textarea', { id: 'review-note', rows: 3, maxlength: 2000, placeholder: 'Note for yourself (optional), e.g. "check the ratio again"' }, a.note || '');
      area.addEventListener('input', () => { setNote(attempt, area.value); dirty = true; });
      area.addEventListener('change', save);
      const box = h('div', { class: 'note-box', role: 'dialog', 'aria-label': 'Mark for review and note' },
        h('div', { class: 'note-title' }, a.marked ? 'Marked for review' : 'Not marked'),
        area,
        h('div', { class: 'note-actions' },
          a.marked
            ? h('button', { type: 'button', class: 'link-btn', id: 'remove-mark', onClick: () => { toggleMark(attempt); noteOpen = false; changed(); save(); } }, 'Remove mark')
            : h('button', { type: 'button', class: 'link-btn', id: 'add-mark', onClick: () => { toggleMark(attempt); changed(); save(); } }, 'Mark for review'),
          h('button', { type: 'button', class: 'btn-outline small', id: 'note-done', onClick: () => { setNote(attempt, area.value); noteOpen = false; changed(); save(); } }, 'Done')));
      setTimeout(() => area.focus(), 0);
      return box;
    }

    function titaBox(a, locked = false) {
      const input = h('input', { type: 'text', id: 'tita-input', class: 'tita-input', value: a.answer ?? '', inputmode: 'none', autocomplete: 'off', 'aria-label': 'Your answer', readOnly: locked });
      const ok = (v) => /^-?\d*\.?\d*$/.test(v) && v.length <= 12;
      const commit = (v) => {
        setAnswer(attempt, v === '' || v === '-' || v === '.' ? null : v, Date.now(), { typing: true });
        dirty = true;
        drawSide();
        // keep the typing box as it is (no full redraw), but update the "Submit question" button
        const btn = main.querySelector('#submit-question');
        if (btn) btn.disabled = attempt.questions[attempt.current].answer === null;
      };
      input.addEventListener('input', () => {
        if (!ok(input.value)) input.value = a.answer ?? '';
        else commit(input.value);
      });
      const key = (k) => {
        let v = input.value;
        if (k === 'BS') v = v.slice(0, -1);
        else if (k === 'Clear') v = '';
        else if (k === '-') v = v.startsWith('-') ? v.slice(1) : '-' + v;
        else v += k;
        if (!ok(v)) return;
        input.value = v;
        commit(v);
      };
      const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '-'];
      if (locked) return h('div', { class: 'tita' }, input);
      return h('div', { class: 'tita' },
        input,
        h('div', { class: 'keypad' },
          keys.map((k) => h('button', { type: 'button', class: 'key', onClick: () => key(k), 'aria-label': k === '-' ? 'minus' : k }, k === '-' ? '−' : k)),
          h('button', { type: 'button', class: 'key wide', onClick: () => key('BS') }, 'Backspace'),
          h('button', { type: 'button', class: 'key wide', onClick: () => key('Clear') }, 'Clear all')));
    }

    function passagePane() {
      const q = byId.get(attempt.questions[attempt.current].questionId);
      return h('section', { class: 'passage-pane', id: 'passage' }, q.images.passage ? imgEl(pic(q.images.passage), 'Passage', 0.55) : h('p', { class: 'muted' }, 'No passage for this question.'));
    }

    function drawMain() {
      const [lo, hi] = openRange(attempt);
      const last = attempt.current === hi;
      const parts = [];
      const curStyle = isMock ? (test.sections.find((x) => x.questionIds.includes(attempt.questions[attempt.current].questionId))?.style || 'A') : style;
      const cur = byId.get(attempt.questions[attempt.current].questionId);
      const hasPassage = !!cur?.images.passage;
      // VA (para jumbles, summaries, ...): the "passage" is the question's own directions and sentences,
      // so it sits above the question in one pane, like Quant. RC and LRDI keep passage left / question right.
      const split = curStyle === 'B' && hasPassage && cur.area !== 'VA';
      screen.classList.toggle('style-B', split);
      screen.classList.toggle('style-A', !split);
      if (sectionNotice) parts.push(h('div', { class: 'box box-warn section-notice', id: 'section-notice', role: 'status' }, sectionNotice));
      if (split) {
        parts.push(h('div', { class: 'set-title' }, setLabel(attempt.current) || ''));
        parts.push(h('div', { class: 'phone-tabs' },
          h('button', { type: 'button', class: phoneTab === 'passage' ? 'on' : '', id: 'tab-passage', onClick: () => { phoneTab = 'passage'; drawMain(); } }, 'Passage'),
          h('button', { type: 'button', class: phoneTab === 'question' ? 'on' : '', id: 'tab-question', onClick: () => { phoneTab = 'question'; drawMain(); } }, 'Question')));
        parts.push(h('div', { class: `panes show-${phoneTab}` }, passagePane(), questionPane()));
      } else {
        parts.push(h('div', { class: 'panes' }, questionPane({ passageAbove: hasPassage })));
      }
      parts.push(h('footer', { class: 'exam-bottom' },
        attempt.current > lo ? h('button', { class: 'btn-outline', type: 'button', id: 'prev-q', onClick: () => go(attempt.current - 1) }, 'Previous') : h('span'),
        h('button', { class: 'btn-outline', type: 'button', id: 'next-q', onClick: () => (last ? askSubmit() : go(attempt.current + 1)) }, last ? (isMock ? 'Submit section' : 'Submit') : 'Next')));
      fill(main, parts);
      if (isMock) drawSectionTabs();
    }

    function drawSectionTabs() {
      const m = attempt.mock;
      fill(secTabs, m.sections.map((sec, i) => {
        const state = i < m.sectionIndex ? 'done' : i === m.sectionIndex ? 'current' : 'locked';
        return h('div', { class: `section-tab ${state}`, role: 'tab', 'aria-selected': String(state === 'current'), id: `sec-tab-${sec.id}` },
          h('span', { class: 'sec-name' }, sec.name), h('span', { class: 'sec-state' }, state === 'done' ? '✓ submitted' : state === 'current' ? `Q${sec.from + 1}–Q${sec.to + 1}` : 'locked'));
      }));
    }

    function drawSide() {
      const c = isMock ? sectionCounts(attempt) : counts(attempt);
      const [lo, hi] = openRange(attempt);
      const groups = [];
      attempt.questions.forEach((a, i) => {
        if (i < lo || i > hi) return;
        const q = byId.get(a.questionId);
        const grouped = isMock ? !!(q && q.setId) || groups.some((g) => g.key.startsWith('set')) : style === 'B';
        const key = grouped && q && q.setId ? q.setId : `single-${Math.floor(i / 6)}`;
        const g = groups[groups.length - 1];
        if (g && g.key === key && grouped) g.items.push(i);
        else if (grouped) groups.push({ key, items: [i] });
        else (groups[0] ||= { key: 'all', items: [] }).items.push(i);
      });
      const cell = (i) => {
        const st = statusOf(attempt.questions[i]);
        return h('button', {
          type: 'button', class: `pal ${st}` + (i === attempt.current ? ' current' : ''), id: `pal-${i + 1}`,
          title: [...PRACTICE_LEGEND, ...LEGEND].find((x) => x[0] === st)[1], onClick: () => { drawerOpen = false; go(i); },
        }, String(i + 1), st === STATUS.ANSWERED_MARKED ? h('span', { class: 'tick' }, '✓') : null, h('span', { class: 'dot' }));
      };
      fill(side,
        h('div', { class: 'legend' }, (attempt.mode === 'practice' ? [...PRACTICE_LEGEND, ...LEGEND] : LEGEND).map(([st, label, k]) => h('div', { class: 'legend-item' },
          h('span', { class: `pal mini ${st}` }, String(c[k]), st === STATUS.ANSWERED_MARKED ? h('span', { class: 'tick' }, '✓') : null), h('span', null, label)))),
        isMock ? h('div', { class: 'side-section' }, `You are viewing ${currentSection(attempt).name}`) : null,
        h('div', { class: `palette ${(isMock ? groups.some((g) => g.key.startsWith('set')) : style === 'B') ? 'grouped' : ''}` }, groups.map((g) => h('div', { class: 'pal-group' }, g.items.map(cell)))));
    }

    function drawCalc() {
      if (!calc) return;
      const tita = byId.get(attempt.questions[attempt.current].questionId).type === 'TITA' && !attempt.questions[attempt.current].checked;
      const k = (label, key, cls = '', aria = label) => h('button', { type: 'button', class: `ck ${cls}`, 'aria-label': `calculator ${aria}`, onClick: () => { calc = press(calc, key); drawCalc(); } }, label);
      const head = h('div', { class: 'calc-head' },
        h('span', null, 'Calculator'),
        h('button', { type: 'button', class: 'calc-x', id: 'calc-close', 'aria-label': 'Close calculator', onClick: () => { calcBox.hidden = true; } }, '✕'));
      fill(calcBox,
        head,
        h('div', { class: 'calc-body' },
          h('div', { class: 'calc-expr', id: 'calc-expr' }, (calc.hasMemory ? 'M  ' : '') + (calc.expr || '')),
          h('div', { class: 'calc-display', id: 'calc-display' }, calc.display),
          h('div', { class: 'calc-mem' }, k('MC', 'MC'), k('MR', 'MR'), k('MS', 'MS'), k('M+', 'M+'), k('M-', 'M-', '', 'M minus')),
          h('div', { class: 'calc-grid' },
            k('←', 'BS', 'red span2', 'backspace'), k('C', 'C', 'red'), k('+/-', 'neg', 'red', 'plus minus'), k('√', 'sqrt', '', 'square root'),
            k('7', '7'), k('8', '8'), k('9', '9'), k('/', '/'), k('%', '%'),
            k('4', '4'), k('5', '5'), k('6', '6'), k('*', '*'), k('1/x', 'recip', '', 'one over x'),
            k('1', '1'), k('2', '2'), k('3', '3'), k('-', '-'), k('=', '=', 'eq', '='),
            k('0', '0', 'span2'), k('.', '.'), k('+', '+')),
          h('div', { class: 'calc-actions' },
            h('button', { type: 'button', class: 'ck', id: 'calc-use', disabled: !tita || usableValue(calc) === null, title: 'Copy the number into the typed-answer box', onClick: () => {
              const v = usableValue(calc);
              if (v === null) return;
              setAnswer(attempt, v, Date.now());
              changed();
              save();
            } }, 'Use'),
            h('button', { type: 'button', class: 'ck', id: 'calc-erase', disabled: !tita, title: 'Clear the typed-answer box', onClick: () => {
              if (ERASE_CLEARS_TYPED_ANSWER) { setAnswer(attempt, null, Date.now()); changed(); save(); }
            } }, 'Erase'))));
      dragBy(head, calcBox);
    }

    function draw() {
      screen.classList.toggle('drawer-open', drawerOpen);
      screen.classList.toggle('side-collapsed', sideCollapsed);
      collapse.textContent = sideCollapsed ? '‹' : '›';
      drawMain();
      drawSide();
      if (!calcBox.hidden) drawCalc();
      updateTimer();
    }

    function updateTimer() {
      const now = Date.now();
      timerEl.textContent = timerText(attempt, now);
      if (practice) {
        // practice mode: the big clock is this question's own; the whole test's time is shown small
        const stopped = clockStopped(attempt, attempt.questions[attempt.current]);
        timerLabel.textContent = stopped ? `Q${attempt.current + 1} took` : `Q${attempt.current + 1}`;
        timerEl.parentElement.classList.toggle('stopped', stopped);
        totalEl.textContent = `Total ${totalTimeText(attempt, now)} of ${test.settings.timeLimitMin} min`;
      }
      if (attempt.status !== 'in-progress') return;
      if (isMock) {
        if (isSectionTimeUp(attempt, now)) advanceSection(true);
      } else if (isTimeUp(attempt, now)) submit(true);
    }

    let advancing = false;
    async function advanceSection(auto) {
      if (advancing || attempt.status !== 'in-progress') return;
      advancing = true;
      const done = currentSection(attempt).name;
      nextSection(attempt, Date.now(), { auto });
      if (attempt.status !== 'in-progress') { advancing = false; return submit(auto, { alreadyFinished: true }); }
      sectionNotice = auto ? `Time is up for ${done} — ${currentSection(attempt).name} has started.` : `${done} submitted — ${currentSection(attempt).name} has started.`;
      setTimeout(() => { sectionNotice = null; if (attempt.status === 'in-progress') drawMain(); }, 8000);
      noteOpen = false; phoneTab = 'question'; drawerOpen = false;
      await save();
      draw();
      main.scrollTop = 0;
      advancing = false;
    }

    function finishAfterCatchUp() {
      // all sections ran out while the user was away: score and go to the results
      submit(true, { alreadyFinished: true });
    }

    async function askSubmit() {
      if (isMock) {
        const c = sectionCounts(attempt);
        const sec = currentSection(attempt);
        const lastSection = attempt.mock.sectionIndex === attempt.mock.sections.length - 1;
        const ok = await confirmDialog({
          title: lastSection ? 'Submit the mock?' : `Submit ${sec.name}?`,
          message: [
            `${sec.name}: answered ${c.answered} · answered & marked ${c.answeredMarked} · not answered ${c.notAnswered} · marked (no answer) ${c.marked} · not visited ${c.notVisited}`,
            lastSection ? 'This is the last section. After submitting you see your score.' : `You cannot come back to ${sec.name}. The next section (${attempt.mock.sections[attempt.mock.sectionIndex + 1].name}) starts immediately; the time left in ${sec.name} is lost.`,
          ],
          okText: lastSection ? 'Submit mock' : `Submit ${sec.name}`, cancelText: 'Keep going',
        });
        if (ok) advanceSection(false);
        return;
      }
      const c = counts(attempt);
      const ok = await confirmDialog({
        title: 'Submit the test?',
        message: [
          ...(attempt.mode === 'practice' ? [`Checked with "Submit question": ${c.correct} correct, ${c.incorrect} incorrect`] : []),
          `Answered: ${c.answered} · Answered & marked: ${c.answeredMarked}`,
          `Not answered: ${c.notAnswered} · Marked (no answer): ${c.marked} · Not visited: ${c.notVisited}`,
          'After submitting you cannot change your answers.',
        ],
        okText: 'Submit', cancelText: 'Keep going',
      });
      if (ok) submit(false);
    }

    async function submit(auto, { alreadyFinished = false } = {}) {
      if (submitting || (!alreadyFinished && attempt.status !== 'in-progress')) return;
      submitting = true;
      stopTimers();
      if (!alreadyFinished) finish(attempt, Date.now(), { auto });
      const result = computeResult(attempt, byId);
      let records = questionAttemptRecords(attempt, byId);
      if (result.scorable) {
        records = scoredRecords(records, result);
        attempt.summary = { score: result.overall.score, maxScore: result.overall.maxScore, correct: result.overall.correct, incorrect: result.overall.incorrect, skipped: result.overall.skipped };
      }
      await saveSubmittedAttempt(attempt, records);
      import('../sync/account.js').then((m) => m.syncSoon()).catch(() => {});
      document.body.classList.remove('in-exam');
      location.hash = `#/result/${attempt.id}?battle=1` + (auto ? '&auto=1' : '');
    }

    async function leave() {
      const ok = await confirmDialog({ title: 'Leave the test?', message: ['Your answers are saved and you can continue later from the library.', 'The timer keeps running while you are away.'], okText: 'Leave', cancelText: 'Stay' });
      if (!ok) return;
      tick(attempt, Date.now(), visible);
      await save();
      const first = byId.get(attempt.questions[0].questionId);
      location.hash = test.kind === 'custom' ? '#/sectional' : test.kind === 'mock' ? '#/library/mock' : topicHref(first?.subject, first?.area);
    }

    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') { tick(attempt, now, visible); visible = false; save(); } else { visible = true; resumeClock(attempt, now); if (isMock && isSectionTimeUp(attempt, now)) advanceSection(true); else updateTimer(); }
    };
    const onPageHide = () => { tick(attempt, Date.now(), visible); putAttempt(attempt); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    (async () => {
      images.map = await getImagesForSources(test.sourceIds);
      resumeClock(attempt, Date.now());
      draw();
    })();
    draw();
    timers.push(setInterval(updateTimer, 250));
    timers.push(setInterval(() => { tick(attempt, Date.now(), visible); if (attempt.status === 'in-progress') save(); }, AUTOSAVE_MS));

    return {
      cleanup: () => {
        if (attempt.status === 'in-progress') { tick(attempt, Date.now(), visible); putAttempt(attempt); }
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        cleanupAll();
      },
    };
  }
}

/** Let the user move a floating panel by dragging its title bar (mouse or finger). */
function dragBy(handle, box) {
  handle.onpointerdown = (e) => {
    if (e.target.closest('button')) return; // the close button must still work
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    handle.onpointermove = (ev) => {
      box.style.left = `${Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx))}px`;
      box.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
      box.style.right = 'auto';
      box.style.bottom = 'auto';
    };
    handle.onpointerup = () => { handle.onpointermove = null; };
  };
}

/** Library helper: start or resume, and "start again" which asks before discarding. */
export async function startOrResume(testId) {
  location.hash = `#/exam/${testId}`;
}

export async function startAgain(testId, attempt) {
  const ok = await confirmDialog({
    title: 'Start this test again?',
    message: ['Your unfinished attempt (answers so far and time used) will be deleted.', 'This cannot be undone.'],
    okText: 'Delete it and start again', cancelText: 'Keep it', danger: true,
  });
  if (!ok) return false;
  await discardAttempt(attempt.id);
  location.hash = `#/exam/${testId}`;
  return true;
}
