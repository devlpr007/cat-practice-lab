// The exam engine: everything that happens during a test, as plain data (no screen, no storage),
// so it can be tested exactly. Times are milliseconds since 1970 (Date.now()); the clock is passed in.
//
// The timer is based on an ABSOLUTE end time (endsAt): refreshing, locking the phone or switching
// apps cannot change it. Time per question is counted only while the test page is visible.

export const STATUS = {
  NOT_VISITED: 'not-visited',
  NOT_ANSWERED: 'not-answered',
  ANSWERED: 'answered',
  MARKED: 'marked',
  ANSWERED_MARKED: 'answered-marked',
  // practice mode only (count-up timer): after "Submit question"
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
};

/**
 * A new attempt. sections: [{ id, name, style, questionIds }] (copied from the test).
 * Count-up timer = practice mode: each question can be submitted on its own to see the solution
 * and whether it was right, and each question has its own clock (it runs while that question is on
 * screen and stops for good once it is submitted). Count-down timer = exam mode: nothing is
 * revealed before the end.
 */
export function createAttempt({ id, test, now, timerDirection = 'down' }) {
  const isMock = test.kind === 'mock';
  if (isMock) timerDirection = 'down'; // a mock is always exam mode
  const durationMs = Math.round(Number(test.settings.timeLimitMin) * 60000);
  const order = test.sections.flatMap((s) => s.questionIds.map((qid) => ({ qid, sectionId: s.id })));
  const state = {
    id,
    testId: test.id,
    status: 'in-progress',
    startedAt: now,
    endsAt: now + durationMs,
    durationMs,
    timerDirection,
    mode: timerDirection === 'up' ? 'practice' : 'exam',
    snapshot: { name: test.name, sections: test.sections, settings: test.settings },
    current: 0,
    lastTick: now,
    questions: order.map(({ qid, sectionId }) => ({
      questionId: qid,
      sectionId,
      answer: null,
      marked: false,
      visits: 0,
      timeSpentMs: 0,
      history: [],
    })),
  };
  if (isMock) {
    // Mock (CAT) timing: sections one after another in fixed order, each with its own clock.
    // A section ends when its time is up (the next one starts at once) or when the user submits it
    // early (the unused time is lost, as in the real exam). Going back is impossible.
    let from = 0;
    let t = now;
    state.mock = { sectionIndex: 0, sections: test.sections.map((sec) => {
      const ms = Math.round(Number(sec.timeLimitMin || test.settings.timeLimitMin / test.sections.length) * 60000);
      const rec = { id: sec.id, name: sec.name, from, to: from + sec.questionIds.length - 1, durationMs: ms, startedAt: t, endsAt: t + ms, submittedAt: null };
      from += sec.questionIds.length;
      t += ms;
      return rec;
    }) };
    state.durationMs = state.mock.sections.reduce((a, x) => a + x.durationMs, 0);
    state.endsAt = now + state.durationMs;
  }
  openQuestion(state, 0, now);
  return state;
}

/** The section the user is in (mocks only), else null. */
export const currentSection = (state) => (state.mock ? state.mock.sections[state.mock.sectionIndex] : null);
/** The end time that matters now: the current section's (mock) or the test's. */
export const currentEndsAt = (state) => (state.mock ? currentSection(state).endsAt : state.endsAt);
/** Indices of the questions the user may open now. */
export function openRange(state) {
  const sec = currentSection(state);
  return sec ? [sec.from, sec.to] : [0, state.questions.length - 1];
}

/**
 * Mock: close the current section (early = by the user, else because its time is up) and start the
 * next one at `at`. After the last section the attempt is finished.
 */
export function nextSection(state, now, { auto = false } = {}) {
  if (state.status !== 'in-progress' || !state.mock) return state;
  const m = state.mock;
  const sec = m.sections[m.sectionIndex];
  tick(state, now);
  sec.submittedAt = auto ? Math.min(now, sec.endsAt) : Math.min(now, sec.endsAt);
  sec.auto = auto;
  if (m.sectionIndex === m.sections.length - 1) {
    state.endsAt = sec.submittedAt;
    return finish(state, now, { auto });
  }
  const at = sec.submittedAt;
  let t = at;
  for (let i = m.sectionIndex + 1; i < m.sections.length; i++) {
    m.sections[i].startedAt = t;
    m.sections[i].endsAt = t + m.sections[i].durationMs;
    t = m.sections[i].endsAt;
  }
  state.endsAt = t;
  m.sectionIndex++;
  state.lastTick = now;
  openQuestion(state, m.sections[m.sectionIndex].from, now);
  return state;
}

/**
 * Mock: catch up with the clock (after a refresh or coming back later): every section whose time
 * ran out is closed automatically, one after another; the attempt finishes if all did.
 */
export function syncSections(state, now) {
  if (state.status !== 'in-progress' || !state.mock) return state;
  let guard = 0;
  while (state.status === 'in-progress' && now >= currentSection(state).endsAt && guard++ < 10) nextSection(state, currentSection(state).endsAt, { auto: true });
  return state;
}

/** Counts over one section's questions (mock palette); counts(state) stays whole-test. */
export function sectionCounts(state, index = state.mock ? state.mock.sectionIndex : 0) {
  const sec = state.mock ? state.mock.sections[index] : { from: 0, to: state.questions.length - 1 };
  const sub = { ...state, questions: state.questions.slice(sec.from, sec.to + 1) };
  return counts(sub);
}

/** A question's own clock has stopped (practice mode: after "Submit question"). */
export const clockStopped = (state, q) => state.mode === 'practice' && !!q.checked;

/** Add the time since the last tick to the question on screen (only if the page was visible). */
export function tick(state, now, visible = true) {
  if (state.status !== 'in-progress') return state;
  const until = Math.min(now, currentEndsAt(state));
  const q = state.questions[state.current];
  if (visible && until > state.lastTick && !clockStopped(state, q)) q.timeSpentMs += until - state.lastTick;
  state.lastTick = now;
  return state;
}

/** Time on the question on screen up to `now` (its saved time plus the part not yet ticked). */
export function questionTimeMs(state, now) {
  const q = state.questions[state.current];
  if (state.status !== 'in-progress' || clockStopped(state, q)) return q.timeSpentMs;
  return q.timeSpentMs + Math.max(0, Math.min(now, currentEndsAt(state)) - state.lastTick);
}

/** Called when the page becomes visible again: time while hidden is not counted per question. */
export function resumeClock(state, now) {
  state.lastTick = now;
  return state;
}

export function openQuestion(state, index, now) {
  if (index < 0 || index >= state.questions.length) return state;
  const [lo, hi] = openRange(state);
  if (index < lo || index > hi) return state; // mock: other sections are locked
  tick(state, now);
  state.current = index;
  state.questions[index].visits += 1;
  return state;
}

/**
 * Set (or clear with null/'') the answer of the question on screen. Every change is kept in the
 * history; while typing a TITA answer within one visit, the last entry is updated instead of
 * adding one entry per key.
 */
export function setAnswer(state, value, now, { typing = false } = {}) {
  if (state.status !== 'in-progress') return state;
  const q = state.questions[state.current];
  if (q.checked) return state; // locked after "Submit question" in practice mode
  const v = value === '' || value === undefined ? null : value;
  if (v === q.answer) return state;
  q.answer = v;
  const last = q.history[q.history.length - 1];
  const at = now - state.startedAt;
  if (typing && last && last.typing && last.visit === q.visits) {
    last.answer = v;
    last.at = at;
  } else {
    q.history.push({ at, answer: v, visit: q.visits, ...(typing ? { typing: true } : {}) });
  }
  return state;
}

/** Optional note on the question on screen (kept even if the mark is removed). */
export function setNote(state, text) {
  if (state.status !== 'in-progress') return state;
  const t = String(text ?? '').slice(0, 2000);
  state.questions[state.current].note = t.trim() ? t : '';
  return state;
}

export function toggleMark(state) {
  if (state.status !== 'in-progress') return state;
  const q = state.questions[state.current];
  q.marked = !q.marked;
  return state;
}

/**
 * Practice mode: lock the answer of the question on screen and record whether it was correct.
 * `correct` is decided by the caller (it knows the key). Needs an answer; works only once.
 */
export function checkQuestion(state, now, correct) {
  if (state.status !== 'in-progress' || state.mode !== 'practice') return state;
  const q = state.questions[state.current];
  if (q.answer === null || q.checked) return state;
  tick(state, now); // the question's clock stops here
  q.checked = { at: now - state.startedAt, correct: !!correct };
  return state;
}

export function statusOf(q) {
  if (q.checked) return q.checked.correct ? STATUS.CORRECT : STATUS.INCORRECT;
  if (q.visits === 0) return STATUS.NOT_VISITED;
  const answered = q.answer !== null;
  if (q.marked) return answered ? STATUS.ANSWERED_MARKED : STATUS.MARKED;
  return answered ? STATUS.ANSWERED : STATUS.NOT_ANSWERED;
}

export function counts(state) {
  const c = { answered: 0, notAnswered: 0, marked: 0, answeredMarked: 0, notVisited: 0, correct: 0, incorrect: 0 };
  for (const q of state.questions) {
    const s = statusOf(q);
    if (s === STATUS.CORRECT) c.correct++;
    else if (s === STATUS.INCORRECT) c.incorrect++;
    else if (s === STATUS.ANSWERED) c.answered++;
    else if (s === STATUS.NOT_ANSWERED) c.notAnswered++;
    else if (s === STATUS.MARKED) c.marked++;
    else if (s === STATUS.ANSWERED_MARKED) c.answeredMarked++;
    else c.notVisited++;
  }
  return c;
}

export const remainingMs = (state, now) => Math.max(0, currentEndsAt(state) - now);
export const elapsedMs = (state, now) => Math.min(state.durationMs, Math.max(0, now - state.startedAt));
export const isTimeUp = (state, now) => now >= state.endsAt;
/** Mock: the current section's time is up (the test as a whole may still be running). */
export const isSectionTimeUp = (state, now) => !!state.mock && now >= currentSection(state).endsAt;

/**
 * What the timer shows. Exam mode (count down): the time left. Practice mode (count up): the time
 * on the question on screen (each question has its own clock).
 */
export function timerText(state, now) {
  return clockText(state.timerDirection === 'up' ? questionTimeMs(state, now) : remainingMs(state, now));
}
/** Practice mode: the whole test's time used so far. */
export const totalTimeText = (state, now) => clockText(elapsedMs(state, now));

export function clockText(ms) {
  const total = Math.floor(ms / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** End the attempt (by the user, or automatically at zero). */
export function finish(state, now, { auto = false } = {}) {
  if (state.status !== 'in-progress') return state;
  tick(state, now);
  state.status = 'submitted';
  state.submittedAt = Math.min(now, state.endsAt);
  state.autoSubmitted = auto;
  return state;
}

/**
 * Per-question records for the questionAttempts store (model.js). Correctness and marks are
 * filled in by scoring (Stage 3); the raw data is produced here.
 */
export function questionAttemptRecords(state, questionsById) {
  return state.questions.map((q) => ({
    id: `${state.id}/${q.questionId}`,
    attemptId: state.id,
    testId: state.testId,
    questionId: q.questionId,
    sourceId: questionsById.get(q.questionId)?.sourceId ?? null,
    sectionId: q.sectionId,
    answer: q.answer,
    correct: null,
    marks: null,
    timeSpentMs: q.timeSpentMs,
    visits: q.visits,
    markedForReview: q.marked,
    status: statusOf(q),
    history: q.history.map(({ at, answer }) => ({ at, answer })),
    practiceCheck: q.checked || null,
    note: q.note || '',
    mistakeReason: null,
  }));
}
