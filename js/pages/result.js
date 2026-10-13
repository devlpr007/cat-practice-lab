// Results of a submitted attempt (#/result/<attemptId>): Performance, Analysis and Solutions tabs.
// Layout follows the user's reference pictures; only real data is shown (no percentile, no
// difficulty levels — the PDFs do not provide them).
import { h, fill, UrlBag, showPicture, formatDate } from '../ui.js';
import { gameOnByDefault } from '../game/defaults.js';
import {
  getAttempt, getTest, getQuestions, getImagesForSources, getQuestionAttempts, updateQuestionAttempt,
  updateQuestionSubTopic, updateQuestionTopic, listQuestions, listAllAttempts, listAllQuestionAttempts, listSources, listTests, getSetting,
} from '../db.js';
import { mockSectionStats, mockTrend, taggingProgress, isUntaggedMock, MOCK_AREA, MOCK_UNTAGGED } from '../mock-stats.js';
import { attemptAccuracyChart, timeSplitChart, mockTrendView } from '../mock-charts.js';
import { areasOf, chaptersOf, AREA_LONG } from '../topics.js';
import { buildFeedback } from '../feedback.js';
import { askAiMessage, combinedPicture } from '../ask-ai.js';
import { victoryBanner, playBattleFor } from './dojo.js';
import { computeResult, formatDuration, TIME_GROUPS } from '../results.js';
import { isCorrect } from '../exam/scoring.js';
import { MISTAKE_REASONS } from '../model.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const RESULT_LABEL = { correct: 'Correct', incorrect: 'Incorrect', skipped: 'Skipped' };

export async function render(root, params) {
  const bag = new UrlBag();
  const attempt = await getAttempt(params.id);
  if (!attempt || attempt.status !== 'submitted') {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', null, 'Result not found'), h('p', null, h('a', { href: '#/library' }, 'Back to the library'))));
    return { cleanup: () => bag.free() };
  }
  const test = await getTest(attempt.testId);
  const qIds = attempt.questions.map((q) => q.questionId);
  const questions = await getQuestions(qIds);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const records = new Map((await getQuestionAttempts(attempt.id)).map((r) => [r.questionId, r]));
  let result = computeResult(attempt, byId);
  const isMock = !!attempt.mock;
  const mockStats = () => mockSectionStats(attempt, result);
  // trend across all submitted mocks (scored with the current questions, so tags show up at once)
  const mockHistory = isMock ? mockTrend(await listAllAttempts(), new Map((await listQuestions()).map((q) => [q.id, q]))) : [];
  const sourceIds = [...new Set(questions.map((q) => q.sourceId))];
  const images = await getImagesForSources(sourceIds);
  const allTopics = [...new Set((await listQuestions()).map((q) => q.subTopic).filter(Boolean))].sort();
  const pic = (id) => {
    const im = id && images.get(id);
    return im ? { src: bag.url(im.blob), width: im.width, height: im.height } : null;
  };
  const img = (p, alt, scale = 0.6, zoom = true) => {
    if (!p) return h('p', { class: 'error' }, 'Picture missing.');
    const el = h('img', { src: p.src, alt, class: 'res-img', width: Math.round(p.width * scale), height: Math.round(p.height * scale) });
    if (zoom) el.addEventListener('click', () => showPicture(p.src, alt));
    return el;
  };

  const gameOn = await getSetting('game.enabled', gameOnByDefault());
  const gameData = gameOn ? { questions: await listQuestions(), attempts: await listAllAttempts(), records: await listAllQuestionAttempts(), tests: await listTests() } : null;
  const victory = gameOn ? await victoryBanner(attempt.id, gameData) : null;
  // the battle scene plays once, right after a submit (never during the test); "Replay battle" shows it again
  if (gameOn && params.battle) {
    history.replaceState(null, '', `#/result/${attempt.id}` + (params.auto ? '?auto=1' : ''));
    playBattleFor(attempt.id, gameData);
  }

  let tab = params.tab || 'performance';
  let current = Number(params.q || 1) - 1;
  let subTab = 'solution';
  let reattempt = false;
  const reattemptState = new Map(); // index -> { answer, checked }
  let filter = 'all';
  let lastTagged = null; // question just tagged: its row says "Saved." after the redraw
  let tagOpen = false; // the "Tag mock questions" list stays open while tagging
  const content = h('div', { class: 'res-content' });
  const page = h('div', { class: 'res-page' });

  if (!result.scorable) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('div', { class: 'box box-error' },
      h('h2', null, 'This attempt cannot be scored'),
      h('ul', null, result.problems.map((p) => h('li', null, p))))));
    return { cleanup: () => bag.free() };
  }

  const tabs = () => h('div', { class: 'res-tabs', role: 'tablist' },
    [['performance', 'Performance'], ['analysis', 'Analysis'], ['solutions', 'Solutions']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', class: tab === id ? 'on' : '', id: `tab-${id}`, 'aria-selected': String(tab === id), onClick: () => { tab = id; draw(); } }, label)));

  function draw() {
    fill(page,
      h('div', { class: 'res-top' },
        test?.kind === 'custom' ? h('a', { class: 'btn-plain', href: '#/sectional' }, '‹ Sectional tests') : h('a', { class: 'btn-plain', href: '#/library' }, '‹ Library'),
        tabs(),
        tab === 'solutions'
          ? h('label', { class: 'toggle', title: 'Try the questions again without seeing the answers' },
            h('span', null, 'Reattempt questions'),
            h('input', { type: 'checkbox', id: 'reattempt-toggle', checked: reattempt, onChange: (e) => { reattempt = e.target.checked; subTab = 'solution'; draw(); } }),
            h('span', { class: 'switch' }))
          : h('span')),
      content);
    if (tab === 'performance') drawPerformance();
    else if (tab === 'analysis') drawAnalysis();
    else drawSolutions();
  }

  // ---------- Performance ----------
  function drawPerformance() {
    if (isMock) return drawMockPerformance();
    const o = result.overall;
    const rows = [o, ...(result.sections.length > 1 || result.sections[0]?.name !== 'Overall' ? result.sections : [])];
    fill(content, h('div', { class: 'res-wrap' },
      params.auto ? h('div', { class: 'box box-warn', role: 'status', id: 'submitted' }, 'Time is up — your test was submitted automatically.') : h('div', { class: 'visually-hidden', id: 'submitted' }, 'Test submitted'),
      victory,
      h('h2', { class: 'res-title' }, `${attempt.snapshot.name} — Scorecard`),
      h('p', { class: 'muted small' },
        `Submitted ${formatDate(new Date(attempt.submittedAt).toISOString())}${attempt.autoSubmitted ? ' (time ran out)' : ''} · `,
        `time used ${formatDuration(attempt.submittedAt - attempt.startedAt)} of ${formatDuration(attempt.durationMs)}`,
        attempt.mode === 'practice' ? ' · practice mode' : ''),
      table(['Section', 'Questions', 'Attempts', 'Correct', 'Incorrect', 'Skipped', 'Score'],
        rows.map((r) => [r.name, r.questions, r.attempted, r.correct, r.incorrect, r.skipped, h('strong', null, `${fmtNum(r.score)} / ${fmtNum(r.maxScore)}`)]), 'score-table'),
      h('div', { class: 'res-cards' },
        card('Accuracy', o.accuracy === null ? '—' : `${o.accuracy}%`, 'of the questions you attempted'),
        card('Negative marks', fmtNum(o.negativeMarks), 'lost on wrong answers'),
        card('Time per attempt', formatDuration(o.avgTimePerAttemptMs), 'average on attempted questions'),
        card('Marked for review', String(result.rows.filter((r) => r.marked).length), 'questions'))));
  }

  // ---------- Performance of a full mock: per-section clock, attempt rate vs accuracy, time ----------
  function drawMockPerformance() {
    const o = result.overall;
    const secs = mockStats();
    const pctOr = (v) => (v == null ? '—' : `${v}%`);
    const timeCell = (s) => h('span', null, formatDuration(s.usedMs), h('span', { class: 'muted small' }, ` / ${formatDuration(s.allottedMs)}`),
      s.endedBy === 'time' ? h('div', { class: 'small ended-time' }, 'time ran out') : s.endedBy === 'you' ? h('div', { class: 'small muted' }, 'submitted early') : null);
    const usedTotal = secs.reduce((a, s) => a + s.usedMs, 0);
    const allotted = secs.reduce((a, s) => a + s.allottedMs, 0);
    const prog = taggingProgress(questions);
    fill(content, h('div', { class: 'res-wrap' },
      params.auto ? h('div', { class: 'box box-warn', role: 'status', id: 'submitted' }, 'Time is up — your mock was submitted automatically.') : h('div', { class: 'visually-hidden', id: 'submitted' }, 'Test submitted'),
      victory,
      h('h2', { class: 'res-title' }, `${attempt.snapshot.name} — Scorecard`),
      h('p', { class: 'muted small' }, `Submitted ${formatDate(new Date(attempt.submittedAt).toISOString())} · time used ${formatDuration(usedTotal)} of ${formatDuration(allotted)} · three sections in fixed order, each with its own clock`),
      table(['Section', 'Questions', 'Attempted', 'Correct', 'Incorrect', 'Skipped', 'Attempt rate', 'Accuracy', 'Negative', 'Time used', 'Score'],
        [[o.name, o.questions, o.attempted, o.correct, o.incorrect, o.skipped, pctOr(Math.round((o.attempted / o.questions) * 1000) / 10), pctOr(o.accuracy), fmtNum(o.negativeMarks), formatDuration(usedTotal), h('strong', null, `${fmtNum(o.score)} / ${fmtNum(o.maxScore)}`)],
          ...secs.map((s) => [s.name, s.questions, s.attempted, s.correct, s.incorrect, s.skipped, pctOr(s.attemptRate), pctOr(s.accuracy), fmtNum(s.negativeMarks), timeCell(s), h('strong', null, `${fmtNum(s.score)} / ${fmtNum(s.maxScore)}`)])], 'score-table mock-score'),
      h('div', { class: 'mock-charts' },
        h('section', { class: 'res-panel' }, h('h3', null, 'Attempt rate and accuracy'), attemptAccuracyChart(secs)),
        h('section', { class: 'res-panel' }, h('h3', null, 'Where each section\'s time went'), timeSplitChart(secs))),
      h('div', { class: 'res-cards' },
        card('Accuracy', o.accuracy === null ? '—' : `${o.accuracy}%`, 'of the questions you attempted'),
        card('Negative marks', fmtNum(o.negativeMarks), 'lost on wrong answers'),
        card('Time per attempt', formatDuration(o.avgTimePerAttemptMs), 'average on attempted questions'),
        card('Tagged questions', `${prog.tagged} / ${prog.total}`, 'have a topic (Analysis → Tag mock questions)'))));
  }

  // ---------- Analysis ----------
  function drawAnalysis() {
    const fold = (title, body, open = true) => h('details', { class: 'res-fold', open }, h('summary', null, title), body);
    const sections = [result.overall, ...result.sections];
    const timeGrid = h('table', { class: 'time-grid' },
      h('thead', null, h('tr', null, h('th', null, 'Section'), TIME_GROUPS.map((g) => h('th', { class: `tg-${g.id}` }, g.label)))),
      h('tbody', null, result.sections.map((s) => h('tr', null,
        h('td', { class: 'sec' }, s.name),
        TIME_GROUPS.map((g) => h('td', null, h('div', { class: 'dots' },
          result.rows.filter((r) => r.sectionId === s.id && r.timeGroup === g.id).map((r) => h('button', {
            type: 'button', class: `dot-q ${r.result}`, title: `Q${r.number}: ${RESULT_LABEL[r.result]}, ${formatDuration(r.timeSpentMs)}`,
            onClick: () => openSolution(r.index),
          }, String(r.number))))))))));
    const topicTable = (list, label) => table([label, 'Questions', 'Attempted', 'Correct', 'Accuracy', 'Avg time / attempt', 'Marks'],
      list.map((t) => [t.name, t.questions, t.attempted, t.correct, t.accuracy === null ? '—' : `${t.accuracy}%`, formatDuration(t.avgTimePerAttemptMs), fmtNum(t.score)]));
    const filters = [['all', 'All'], ['incorrect', 'Wrong only'], ['skipped', 'Skipped'], ['slow', 'Slow (over 3 min)'], ['marked', 'Marked']];
    const shown = result.rows.filter((r) => filter === 'all' || (filter === 'slow' ? r.slow : filter === 'marked' ? r.marked : r.result === filter));
    const answerText = (r, v) => (v == null ? '—' : r.type === 'MCQ' ? v : v);
    fill(content, h('div', { class: 'res-wrap' },
      isMock ? fold(`Your mocks so far (${mockHistory.length})`, mockTrendView(mockHistory)) : null,
      isMock ? fold(`Tag mock questions (${taggingProgress(questions).tagged} of ${questions.length} tagged)`, tagTable(), tagOpen) : null,
      fold('Score Analysis', table(['Section', 'Marks', 'Questions', 'Attempted', 'Correct', 'Accuracy', 'Time / attempt'],
        sections.map((r) => [r.name, fmtNum(r.score), r.questions, r.attempted, r.correct, r.accuracy === null ? '—' : `${r.accuracy}%`, formatDuration(r.avgTimePerAttemptMs)]), 'score-table')),
      fold('Time Analysis', h('div', null,
        h('p', { class: 'muted small' }, 'Questions grouped by the time you spent on them (your PDFs do not mark difficulty). Green = correct, red = wrong, white = skipped. Click a number to open its solution.'),
        timeGrid)),
      fold('Topic Analysis', h('div', null,
        topicTable(result.topics, 'Topic'),
        topicTable(result.subTopics, 'Sub-topic'),
        result.tags.length ? topicTable(result.tags, 'Your tag') : h('p', { class: 'muted small' }, 'Your tags: none yet. You can tag each question (e.g. "wavy curve method") in Solutions → Q. Analysis.'))),
      fold('All Questions', h('div', null,
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter questions' }, filters.map(([id, label]) =>
          h('button', { type: 'button', class: 'chip' + (filter === id ? ' on' : ''), id: `filter-${id}`, onClick: () => { filter = id; drawAnalysis(); } }, label))),
        h('table', { class: 'q-table', id: 'all-questions' },
          h('thead', null, h('tr', null, ['Q', 'Topic', 'Sub-topic', 'Your tag', 'Your answer', 'Correct answer', 'Result', 'Marks', 'Time', 'Visits', ''].map((t) => h('th', null, t)))),
          h('tbody', null, shown.map((r) => h('tr', { class: `row-${r.result}`, dataset: { q: String(r.number) } },
            h('td', null, String(r.number)), h('td', null, r.area || 'Not set'), h('td', null, r.chapter || 'Not set'), h('td', null, r.subTopic || '—'),
            h('td', null, answerText(r, r.given)), h('td', null, answerText(r, r.key)),
            h('td', null, h('span', { class: `badge ${r.result}` }, RESULT_LABEL[r.result])),
            h('td', null, fmtNum(r.marks)), h('td', null, formatDuration(r.timeSpentMs)), h('td', null, String(r.visits)),
            h('td', null, h('button', { type: 'button', class: 'link-btn', onClick: () => openSolution(r.index) }, 'Solution')))))),
        shown.length ? null : h('p', { class: 'muted' }, 'No questions match this filter.')))));
  }

  // ---------- tagging mock questions: Topic + Sub-topic per question ----------
  function topicEditor(q, onSaved, idPrefix = 'mock') {
    const areaSel = h('select', { id: `${idPrefix}-area-${q.n}`, 'aria-label': `Topic of question ${q.n}` },
      h('option', { value: '' }, '— not tagged —'),
      areasOf(q.subject).map((a) => h('option', { value: a, selected: q.area === a }, AREA_LONG[a] ? `${a} (${AREA_LONG[a]})` : a)));
    const listId = `${idPrefix}-chapters-${q.n}`;
    const chapterIn = h('input', { type: 'text', id: `${idPrefix}-chapter-${q.n}`, 'aria-label': `Sub-topic of question ${q.n}`, value: isUntaggedMock(q) ? '' : (q.chapter || ''), list: listId, placeholder: 'Sub-topic', maxlength: 80 });
    const list = h('datalist', { id: listId }, chaptersOf(q.area).map((c) => h('option', { value: c })));
    const status = h('span', { class: lastTagged === q.id ? 'ok small' : 'small', role: 'status' }, lastTagged === q.id ? 'Saved.' : '');
    areaSel.addEventListener('change', () => list.replaceChildren(...chaptersOf(areaSel.value).map((c) => h('option', { value: c }))));
    const save = async () => {
      const area = areaSel.value;
      const chapter = chapterIn.value.trim();
      if (area && !chapter) { status.className = 'error small'; status.textContent = 'Type the sub-topic too.'; return; }
      const [a, c] = area ? [area, chapter] : [MOCK_AREA, MOCK_UNTAGGED];
      await updateQuestionTopic(q.id, a, c);
      q.area = a; q.chapter = c;
      result = computeResult(attempt, byId);
      status.className = 'ok small'; status.textContent = 'Saved.';
      lastTagged = q.id;
      if (onSaved) onSaved();
    };
    return h('span', { class: 'topic-editor' }, areaSel, chapterIn, list,
      h('button', { type: 'button', class: 'btn-outline small', id: `${idPrefix}-save-${q.n}`, onClick: save }, 'Save'), status);
  }

  function tagTable() {
    const counter = h('p', { class: 'small', id: 'tag-progress' });
    const p0 = taggingProgress(questions);
    counter.textContent = `${p0.tagged} of ${p0.total} questions tagged. Untagged questions count as "Mock – not tagged" and are left out of topic advice.`;
    // after a save the whole analysis is drawn again (topic tables use the new tag), in place
    const showCount = () => { const y = window.scrollY; tagOpen = true; drawAnalysis(); window.scrollTo(0, y); };
    return h('div', null,
      h('p', { class: 'muted small' }, 'Give each question its Topic and Sub-topic (pick from the list or type one). Tagged questions then count in your topic statistics, Feedback and the game like DPP questions.'),
      counter,
      h('table', { class: 'q-table tag-table', id: 'tag-table' },
        h('thead', null, h('tr', null, ['Q', 'Section', 'Result', 'Topic and sub-topic', ''].map((t) => h('th', null, t)))),
        h('tbody', null, result.rows.map((r) => {
          const q = byId.get(r.questionId);
          return h('tr', { dataset: { q: String(r.number) } },
            h('td', null, String(r.number)),
            h('td', null, attempt.snapshot.sections.find((s) => s.id === r.sectionId)?.name || ''),
            h('td', null, h('span', { class: `badge ${r.result}` }, RESULT_LABEL[r.result])),
            h('td', null, topicEditor(q, showCount, 'tag')),
            h('td', null, h('button', { type: 'button', class: 'link-btn', onClick: () => openSolution(r.index) }, 'Solution')));
        }))));
  }

  function openSolution(index) {
    tab = 'solutions';
    current = index;
    subTab = 'solution';
    draw();
    window.scrollTo(0, 0);
  }

  // ---------- Solutions ----------
  function drawSolutions() {
    const r = result.rows[current];
    const q = byId.get(r.questionId);
    const p = q.images;
    const re = reattempt ? (reattemptState.get(current) || { answer: null, checked: null }) : null;
    const reveal = !reattempt || (re && re.checked) || (re && re.shown);
    const head = h('div', { class: 'sol-head' },
      h('span', { class: 'sol-title' }, `Question ${r.number}`),
      !reattempt ? h('span', { class: `badge ${r.result}`, id: 'sol-status' }, RESULT_LABEL[r.result]) : null,
      r.marked ? h('span', { class: 'badge marked', title: 'You marked this for review' }, 'Marked') : null,
      h('span', { class: 'spacer' }),
      !reattempt ? h('button', { type: 'button', class: 'btn-outline small', id: 'ask-ai', title: 'Prepare a message about this question for any AI chat app (the app itself calls no AI)', onClick: () => openAskAi(r, q) }, 'Ask AI') : null,
      reattempt && !reveal ? h('button', { type: 'button', class: 'btn-outline small', id: 'show-answer', onClick: () => { reattemptState.set(current, { ...re, shown: true }); drawSolutions(); } }, 'Show answer') : null);
    const body = [];
    if (p.passage) {
      body.push(h('details', { class: 'passage-fold', open: true }, h('summary', null, 'Passage / data'), img(pic(p.passage), 'Passage', 0.5)));
    }
    if (q.optionsMode === 'separate' && q.stemHeight) {
      const s = pic(p.question);
      if (s) {
        const w = Math.round(s.width * 0.6);
        const clip = h('div', { class: 'clip res-img', style: { width: `${w}px`, maxWidth: '100%', aspectRatio: `${s.width} / ${q.stemHeight}` } }, h('img', { src: s.src, alt: 'Question', style: { width: '100%', height: 'auto' } }));
        clip.addEventListener('click', () => showPicture(s.src, `Question ${r.number}`));
        body.push(clip);
      }
    } else {
      body.push(img(pic(p.question), `Question ${r.number}`));
    }
    const given = reattempt ? re.answer : r.given;
    if (q.type === 'MCQ') {
      body.push(h('div', { class: 'sol-options' }, LETTERS.map((L) => {
        const isKey = q.answer === L;
        const isGiven = given === L;
        let cls = 'sol-opt';
        if (reveal && isKey) cls += ' right';
        else if (reveal && isGiven) cls += ' wrong';
        else if (isGiven) cls += ' chosen';
        const mark = reveal && isKey ? '✓' : reveal && isGiven ? '✕' : L;
        const content = q.optionsMode === 'separate' && p.options ? img(pic(p.options[L]), `Option ${L}`, 0.6, false) : h('span', { class: 'muted' }, `Option ${L} (in the question picture)`);
        return h('button', {
          type: 'button', class: cls, id: `sol-opt-${L}`, disabled: !reattempt || (re && re.checked),
          onClick: () => { reattemptState.set(current, { ...re, answer: L }); drawSolutions(); },
        }, h('span', { class: 'sol-letter' }, mark), h('span', { class: 'opt-body' }, content));
      })));
    } else {
      if (reattempt && !(re && re.checked)) {
        const input = h('input', { type: 'text', id: 'reattempt-input', class: 'tita-input', value: re.answer ?? '', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Type your answer' });
        input.addEventListener('input', () => { reattemptState.set(current, { ...re, answer: input.value.trim() || null }); const b = content.querySelector('#reattempt-check'); if (b) b.disabled = !input.value.trim(); });
        body.push(h('div', { class: 'tita' }, input));
      }
      if (reveal) {
        body.push(h('p', { class: 'tita-result' },
          'Your answer: ', h('strong', null, given ?? '—'), ' · Correct answer: ', h('strong', null, q.answer)));
      }
    }
    if (reattempt && !(re && re.checked)) {
      body.push(h('button', { type: 'button', class: 'btn-primary-solid', id: 'reattempt-check', disabled: re.answer == null, onClick: async () => {
        const ok = isCorrect(q.type, re.answer, q.answer);
        reattemptState.set(current, { ...re, checked: { correct: ok } });
        const rec = records.get(q.id);
        if (rec) {
          const reattempts = [...(rec.reattempts || []), { at: Date.now(), answer: re.answer, correct: ok }];
          await updateQuestionAttempt(rec.id, { reattempts });
          records.set(q.id, { ...rec, reattempts });
        }
        drawSolutions();
      } }, 'Check answer'));
    }
    if (reattempt && re && re.checked) {
      body.push(h('div', { class: `result ${re.checked.correct ? 'ok' : 'bad'}`, id: 'reattempt-result' }, re.checked.correct ? 'Correct this time' : 'Not correct'));
    }
    if (reveal) body.push(h('div', { class: 'solution' }, h('h3', null, 'Solution'), img(pic(p.solution), `Solution ${r.number}`)));

    const left = h('div', { class: 'sol-main' },
      h('div', { class: 'sub-tabs' },
        h('button', { type: 'button', class: subTab === 'solution' ? 'on' : '', id: 'subtab-solution', onClick: () => { subTab = 'solution'; drawSolutions(); } }, 'Question & Solution'),
        h('button', { type: 'button', class: subTab === 'analysis' ? 'on' : '', id: 'subtab-analysis', onClick: () => { subTab = 'analysis'; drawSolutions(); } }, 'Q. Analysis')),
      h('div', { class: 'sol-scroll' }, head, subTab === 'solution' ? body : questionAnalysis(r, q)),
      h('div', { class: 'sol-bottom' },
        h('button', { type: 'button', class: 'btn-outline', id: 'prev-sol', disabled: current === 0, onClick: () => { current--; subTab = 'solution'; drawSolutions(); } }, 'Previous Question'),
        h('button', { type: 'button', class: 'btn-primary-solid', id: 'next-sol', disabled: current === result.rows.length - 1, onClick: () => { current++; subTab = 'solution'; drawSolutions(); } }, 'Next Question')));
    fill(content, h('div', { class: 'sol-layout' }, left, solutionPalette()));
  }

  // ---------- Ask AI (no AI inside: builds a message + picture to copy or share) ----------
  async function openAskAi(r, q) {
    const [allQ, attempts, recs, sources] = await Promise.all([listQuestions(), listAllAttempts(), listAllQuestionAttempts(), listSources()]);
    const fb = buildFeedback({ questions: allQ, attempts, records: recs, sources, subject: q.subject });
    const key = `${q.subject}|${q.area || ''}|${q.chapter || ''}`;
    const submitted = new Set(attempts.filter((a) => a.status === 'submitted').map((a) => a.id));
    const mine = recs.filter((x) => x.questionId === q.id && submitted.has(x.attemptId) && (x.answer != null || x.visits > 0));
    const qById = new Map(allQ.map((x) => [x.id, x]));
    const reasonCount = new Map();
    for (const x of recs) {
      const qq = qById.get(x.questionId);
      if (!x.mistakeReason || !submitted.has(x.attemptId) || !qq || `${qq.subject}|${qq.area || ''}|${qq.chapter || ''}` !== key) continue;
      const label = MISTAKE_REASONS.find((m) => m.code === x.mistakeReason.code)?.label || x.mistakeReason.code;
      reasonCount.set(label, (reasonCount.get(label) || 0) + 1);
    }
    const src = sources.find((x) => x.id === q.sourceId);
    const ref = `${src?.name || 'PDF'}, Q${q.n}`;
    const text = askAiMessage({
      q, row: r, ref,
      related: {
        group: fb.groups.find((g) => g.key === key) || null,
        history: { seen: mine.length, wrong: mine.filter((x) => x.correct === false).length },
        repeatedInGroup: fb.repeated.filter((x) => `${x.subject}|${x.area}|${x.chapter}` === key).length,
        reasons: [...reasonCount].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      },
    });
    const blobOf = (id) => (id && images.get(id)?.blob) || null;
    const picture = await combinedPicture([
      ...(q.images.passage ? [{ label: 'Passage / data', blob: blobOf(q.images.passage) }] : []),
      { label: `Question (${ref})`, blob: blobOf(q.images.question) },
      { label: 'Solution (from the institute PDF)', blob: blobOf(q.images.solution) },
    ]);
    const fileName = `question-${(src?.name || 'pdf').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-q${q.n}.png`;
    const file = new File([picture], fileName, { type: 'image/png' });
    const status = h('p', { role: 'status', class: 'small', id: 'ask-ai-status' });
    const say = (ok, msg) => { status.className = (ok ? 'ok' : 'error') + ' small'; status.textContent = msg; };
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    const canCopyPicture = typeof window.ClipboardItem === 'function' && !!navigator.clipboard?.write;
    const area = h('textarea', { class: 'report-text', id: 'ask-ai-text', readonly: true, rows: 10 }, text);
    const pictureUrl = bag.url(picture);
    const dlg = h('dialog', { class: 'dialog ask-ai-dialog', id: 'ask-ai-dialog' },
      h('h2', null, `Ask AI about Question ${r.number}`),
      h('p', { class: 'small' }, 'The app does not contact any AI. It prepares a message and a picture that you paste into any AI chat app you like (free or paid).'),
      h('ol', { class: 'small' },
        h('li', null, canShare ? 'Press "Share" and choose your AI app, or press "Copy message" and paste it into the chat.' : 'Press "Copy message" and paste it into your AI chat.'),
        h('li', null, 'Then press "Copy picture" (or "Download picture") and paste or attach the picture in the same chat.')),
      area,
      h('img', { src: pictureUrl, alt: 'Question and solution picture', class: 'ask-ai-preview', id: 'ask-ai-picture' }),
      status,
      h('div', { class: 'dialog-buttons ask-ai-buttons' },
        canShare ? h('button', { type: 'button', class: 'btn btn-primary', id: 'ask-ai-share', onClick: async () => {
          try { await navigator.share({ text, files: [file], title: `Question ${r.number}` }); say(true, 'Shared. If your app only received the picture, also use "Copy message".'); } catch (err) { if (err?.name !== 'AbortError') say(false, 'Sharing did not work here. Use Copy message and Download picture instead.'); }
        } }, 'Share') : null,
        h('button', { type: 'button', class: 'btn', id: 'ask-ai-copy-text', onClick: async () => {
          try { await navigator.clipboard.writeText(text); say(true, 'Message copied. Paste it into your AI chat.'); } catch { area.select(); say(false, 'Copying was blocked by the browser: the message is selected — press Ctrl+C (or long-press → Copy).'); }
        } }, 'Copy message'),
        canCopyPicture ? h('button', { type: 'button', class: 'btn', id: 'ask-ai-copy-picture', onClick: async () => {
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture })]); say(true, 'Picture copied. Paste it into the same chat.'); } catch { say(false, 'This browser cannot copy pictures. Use "Download picture" and attach the file.'); }
        } }, 'Copy picture') : null,
        h('a', { class: 'btn', id: 'ask-ai-download', href: pictureUrl, download: fileName }, 'Download picture'),
        h('button', { type: 'button', class: 'btn', id: 'ask-ai-close', onClick: () => dlg.close() }, 'Close')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function questionAnalysis(r, q) {
    const rec = records.get(q.id) || {};
    const reason = rec.mistakeReason || null;
    const reasonSel = h('select', { id: 'mistake-reason' },
      h('option', { value: '' }, '— none —'),
      MISTAKE_REASONS.map((m) => h('option', { value: m.code, selected: reason && reason.code === m.code }, m.label)));
    const reasonNote = h('input', { type: 'text', id: 'mistake-note', value: reason?.note || '', placeholder: 'Optional note', maxlength: 300 });
    const saveReason = async () => {
      const value = reasonSel.value ? { code: reasonSel.value, note: reasonNote.value.trim(), at: Date.now() } : null;
      if (rec.id) await updateQuestionAttempt(rec.id, { mistakeReason: value });
      records.set(q.id, { ...rec, mistakeReason: value });
      saved.textContent = 'Saved.';
    };
    const subTopicIn = h('input', { type: 'text', id: 'sub-topic', value: q.subTopic || '', list: 'subtopic-list', placeholder: 'e.g. wavy curve method', maxlength: 80 });
    const saved = h('span', { class: 'ok small', role: 'status' });
    const saveSubTopic = async () => {
      const v = subTopicIn.value.trim();
      await updateQuestionSubTopic(q.id, v);
      q.subTopic = v;
      result = computeResult(attempt, byId);
      saved.textContent = 'Saved.';
    };
    const history = (r.history || []).map((x) => `${formatDuration(x.at)} → ${x.answer == null ? 'cleared' : x.answer}`);
    return h('div', { class: 'qa' },
      h('table', { class: 'facts' }, h('tbody', null,
        [['Your answer', r.given ?? 'not answered'], ['Correct answer', r.key], ['Result', RESULT_LABEL[r.result]], ['Marks', fmtNum(r.marks)],
          ['Time spent', formatDuration(r.timeSpentMs)], ['Average time per attempted question (this test)', formatDuration(result.overall.avgTimePerAttemptMs)],
          ['Visits', String(r.visits)], ['Answer changes', history.length ? history.join(', ') : 'none'],
          ['Marked for review', r.marked ? 'yes' : 'no'], ['Your note', r.note || '—'],
          ...(r.practiceCheck ? [['Checked during practice', r.practiceCheck.correct ? 'correct' : 'wrong']] : []),
          ...(isMock ? [] : [['Topic', q.area || 'Not set'], ['Sub-topic', q.chapter || 'Not set']]), ['PDF heading', q.topic]].map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v))))),
      isMock ? h('div', { class: 'qa-edit' }, h('span', { class: 'field' }, h('span', null, 'Topic and sub-topic of this mock question')), topicEditor(q, null, 'qa')) : null,
      h('div', { class: 'qa-edit' },
        h('label', { class: 'field' }, h('span', null, 'Your tag (optional, e.g. a method or trap)'), subTopicIn),
        h('button', { type: 'button', class: 'btn-outline small', id: 'save-sub-topic', onClick: saveSubTopic }, 'Save tag'),
        h('datalist', { id: 'subtopic-list' }, allTopics.map((t) => h('option', { value: t })))),
      r.result !== 'correct' ? h('div', { class: 'qa-edit' },
        h('label', { class: 'field' }, h('span', null, 'Why did this go wrong? (optional)'), reasonSel),
        h('label', { class: 'field' }, h('span', null, 'Note'), reasonNote),
        h('button', { type: 'button', class: 'btn-outline small', id: 'save-reason', onClick: saveReason }, 'Save reason')) : null,
      saved);
  }

  function solutionPalette() {
    const groups = attempt.snapshot.sections.map((s) => ({ s, rows: result.rows.filter((r) => r.sectionId === s.id) }));
    const marked = result.rows.filter((r) => r.marked);
    const cell = (r, prefix = 'sol-pal') => h('button', {
      type: 'button', class: `dot-q ${reattempt ? 'neutral' : r.result}` + (r.index === current ? ' current' : ''), id: `${prefix}-${r.number}`,
      title: `Q${r.number}`, onClick: () => { current = r.index; subTab = 'solution'; drawSolutions(); },
    }, String(r.number));
    return h('aside', { class: 'sol-side' },
      groups.map(({ s, rows }) => h('details', { class: 'acc', open: rows.some((r) => r.index === current) },
        h('summary', null, s.name), h('div', { class: 'dots' }, rows.map((r) => cell(r))))),
      reattempt ? null : h('div', { class: 'sol-legend' },
        h('span', null, h('i', { class: 'lg correct' }), 'Correct'), h('span', null, h('i', { class: 'lg incorrect' }), 'Incorrect'), h('span', null, h('i', { class: 'lg skipped' }), 'Skipped')),
      h('details', { class: 'acc' }, h('summary', null, `Bookmark (${marked.length})`),
        marked.length ? h('div', { class: 'dots' }, marked.map((r) => cell(r, 'sol-bm'))) : h('p', { class: 'muted small' }, 'No questions were marked for review.')));
  }

  draw();
  root.replaceChildren(page);
  return { cleanup: () => bag.free() };
}

function table(head, rows, cls = '') {
  return h('table', { class: `res-table ${cls}` },
    h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));
}

function card(title, value, note) {
  return h('div', { class: 'res-card' }, h('div', { class: 'res-card-title' }, title), h('div', { class: 'res-card-value' }, value), h('div', { class: 'muted small' }, note));
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100);
}
