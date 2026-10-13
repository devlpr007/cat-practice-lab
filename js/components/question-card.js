// One question on the parser review page / saved-test page: the question as it will appear in the
// test, the answer-key strip next to the answer the app read (editable on the review page), and
// the solution picture.
import { h, fill, picture, clippedPicture } from '../ui.js';
import { answerKind } from '../parser/validate.js';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * q: { n, answer: { value, detected, edited, readClearly }, optionsMode, stemHeight, markersFound,
 *      pics: { question, options, solution, keyStrip } (each { src, width, height } or null),
 *      notes: [strings] }
 * onAnswer(newValue) — present only on the review page (editable).
 */
export function questionCard(q, { onAnswer = null } = {}) {
  const card = h('article', { class: 'qcard', id: `q-${q.n}`, dataset: { n: String(q.n) } });
  const render = () => {
    const kind = answerKind(q.answer.value);
    const flagged = q.notes.length > 0 || !kind || q.answer.edited || (kind === 'MCQ' && q.optionsMode !== 'separate');
    card.classList.toggle('flagged', flagged);
    card.dataset.flagged = flagged ? 'yes' : 'no';
    fill(card,
      h('header', { class: 'qcard-head' },
        h('h3', null, `Q${q.n}`),
        h('span', { class: 'tag' }, kind === 'MCQ' ? 'MCQ (options a–d)' : kind === 'TITA' ? 'TITA (typed answer)' : 'answer missing'),
        q.answer.edited ? h('span', { class: 'tag tag-edited' }, 'answer edited by me') : null,
        kind === 'MCQ' && q.optionsMode !== 'separate' ? h('span', { class: 'tag tag-warn' }, 'options not cut out') : null,
        !kind ? h('span', { class: 'tag tag-error' }, 'needs your answer') : null),
      h('div', { class: 'qcard-body' },
        questionSection(q, kind),
        keySection(q, kind, onAnswer, render),
        solutionSection(q)),
      q.notes.length ? h('ul', { class: 'notes' }, q.notes.map((t) => h('li', null, t))) : null,
    );
  };
  render();
  return card;
}

function questionSection(q, kind) {
  const p = q.pics;
  const parts = [h('h4', null, 'Question, as it will appear in the test')];
  if (p.passage) {
    parts.push(h('details', { class: 'passage-fold' },
      h('summary', null, q.setLabel ? `Passage / data for ${q.setLabel}` : 'Passage / data for this question'),
      picture(p.passage.src, { ...p.passage, alt: `Passage for question ${q.n}`, scale: 0.45 })));
  } else if (q.setId) {
    parts.push(h('p', { class: 'error' }, 'No passage picture.'));
  }
  if (!p.question) {
    parts.push(h('p', { class: 'error' }, 'No question picture.'));
  } else if (kind === 'MCQ' && q.optionsMode === 'separate' && p.options) {
    parts.push(clippedPicture(p.question.src, { ...p.question, visibleHeight: q.stemHeight, alt: `Question ${q.n}` }));
    parts.push(h('ol', { class: 'options' }, LETTERS.map((L) => h('li', null,
      h('span', { class: 'opt-letter' }, `${L.toLowerCase()})`),
      p.options[L] ? picture(p.options[L].src, { ...p.options[L], alt: `Q${q.n} option ${L}` }) : h('span', { class: 'error' }, 'missing')))));
  } else {
    parts.push(picture(p.question.src, { ...p.question, alt: `Question ${q.n}` }));
    if (kind === 'MCQ') parts.push(h('p', { class: 'muted small' }, 'The options are inside this picture; the test will show buttons a) b) c) d) below it.'));
    if (kind === 'TITA') parts.push(h('p', { class: 'muted small' }, 'Typed answer: the test will show a number box and keypad.'));
  }
  return h('section', { class: 'qcard-question' }, parts);
}

function keySection(q, kind, onAnswer, rerender) {
  const p = q.pics;
  const sec = h('section', { class: 'qcard-key' }, h('h4', null, 'Answer key'));
  sec.append(p.keyStrip ? picture(p.keyStrip.src, { ...p.keyStrip, alt: `Answer key line for Q${q.n}` }) : h('p', { class: 'error' }, 'No answer-key picture.'));
  sec.append(h('p', null, 'Read from the PDF: ',
    q.answer.detected != null ? h('strong', { class: 'answer' }, q.answer.detected) : h('strong', { class: 'error' }, 'could not be read clearly')));
  if (!onAnswer) {
    if (q.answer.edited) sec.append(h('p', null, 'Answer used (edited by me): ', h('strong', { class: 'answer' }, q.answer.value)));
    return sec;
  }
  const input = h('input', {
    type: 'text', class: 'answer-input', value: q.answer.value ?? '', size: 8, autocomplete: 'off',
    'aria-label': `Answer for Q${q.n}`, placeholder: 'A–D or number',
  });
  const set = (v) => {
    onAnswer(v);
    rerender();
  };
  input.addEventListener('change', () => set(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') set(input.value); });
  sec.append(h('div', { class: 'answer-edit' },
    h('span', null, 'Answer to use: '),
    LETTERS.map((L) => h('button', {
      type: 'button', class: 'btn btn-small' + (String(q.answer.value).toUpperCase() === L ? ' btn-selected' : ''),
      onClick: () => set(L), 'aria-label': `Set answer of Q${q.n} to ${L}`,
    }, L)),
    input));
  const status = !kind
    ? h('p', { class: 'error small' }, 'Type A, B, C or D, or a number (for typed-answer questions).')
    : h('p', { class: 'muted small' }, kind === 'MCQ' ? `Multiple choice, correct option ${String(q.answer.value).toUpperCase()}.` : `Typed answer, correct value ${q.answer.value} (compared as a number).`);
  sec.append(status);
  if (q.answer.edited) {
    sec.append(h('button', { type: 'button', class: 'btn btn-small btn-link', onClick: () => set(q.answer.detected ?? '') }, 'Undo my edit'));
  }
  return sec;
}

function solutionSection(q) {
  const p = q.pics;
  return h('section', { class: 'qcard-solution' },
    h('h4', null, 'Solution'),
    p.solution ? picture(p.solution.src, { ...p.solution, alt: `Solution ${q.n}`, scale: 0.45 }) : h('p', { class: 'error' }, 'No solution picture.'));
}
