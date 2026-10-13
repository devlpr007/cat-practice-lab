// Custom sectional tests (pure code, unit-testable in Node): which questions are "new" or "weak"
// for the user, and picking questions for a test. Uses only what was recorded in submitted tests.
//
// Rules agreed with the user (2026-10-13), each one a constant here so it is easy to change:
// - New-questions test: never uses a question already answered correctly in any submitted test.
// - Weak questions: answered wrong, left unanswered after looking at it, or correct but slow
//   (over SLOW_MS). A weak question leaves the weak list after it is answered correctly within
//   SLOW_MS in RIGHT_TO_LEAVE_WEAK later tests. A new wrong / skipped / slow answer starts again.
// - Re-tries on the result page do not count (the answer may have been seen there).
// - VARC / LRDI: questions sharing one passage (setId) are picked together, never split.
import { SLOW_MS } from './results.js';
import { styleForSubject } from './model.js';
import { groupKey } from './topics.js';

export const RIGHT_TO_LEAVE_WEAK = 2;

/** CAT pace used for the suggested time: 40 minutes for 22 questions (VARC: 24). */
export function suggestedMinutes(subject, count) {
  const perSection = subject === 'VARC' ? 24 : 22;
  return Math.max(1, Math.round((count * 40) / perSection));
}

/** What one recorded answer means for the weak list. */
export function outcomeOf(record) {
  if (record.correct === true) return record.timeSpentMs > SLOW_MS ? 'slow' : 'right';
  if (record.correct === false) return 'wrong';
  if (record.answer == null) return record.visits > 0 ? 'skipped' : 'unseen';
  return null; // answered but not scored (key not approved at the time): ignored
}

/**
 * records: all questionAttempts; attempts: all attempts (only submitted ones count, in the order
 * they were submitted). Returns Map(questionId -> { everCorrect, weak, weakReason, rightSinceWeak,
 * seen, lastAt }).
 */
export function questionHistory(records, attempts) {
  const when = new Map(attempts.filter((a) => a.status === 'submitted').map((a) => [a.id, a.submittedAt]));
  const events = new Map();
  for (const r of records) {
    const at = when.get(r.attemptId);
    if (at == null) continue;
    if (!events.has(r.questionId)) events.set(r.questionId, []);
    events.get(r.questionId).push({ at, r });
  }
  const out = new Map();
  for (const [qid, list] of events) {
    list.sort((a, b) => a.at - b.at);
    const h = { everCorrect: false, weak: false, weakReason: null, rightSinceWeak: 0, seen: 0, lastAt: null };
    for (const { at, r } of list) {
      const o = outcomeOf(r);
      if (!o) continue;
      h.lastAt = at;
      if (o !== 'unseen') h.seen++;
      if (o === 'right' || o === 'slow') h.everCorrect = true;
      if (o === 'wrong' || o === 'skipped' || o === 'slow') {
        h.weak = true; h.weakReason = o; h.rightSinceWeak = 0;
      } else if (o === 'right' && h.weak) {
        h.rightSinceWeak++;
        if (h.rightSinceWeak >= RIGHT_TO_LEAVE_WEAK) { h.weak = false; h.weakReason = null; }
      }
    }
    out.set(qid, h);
  }
  return out;
}

/** Is this question available for a test of the given mode ('new' | 'weak')? */
export function isEligible(q, history, mode) {
  if (!q.keyApprovedAt) return false;
  const h = history.get(q.id);
  return mode === 'weak' ? Boolean(h?.weak) : !h?.everCorrect;
}

/**
 * Available questions per Topic › Sub-topic for one subject and mode:
 * Map(groupKey -> { area, chapter, available, total }) (groupKey from topics.js).
 */
export function groupAvailability(questions, history, subject, mode) {
  const m = new Map();
  for (const q of questions) {
    if (q.subject !== subject) continue;
    const k = groupKey(q);
    const t = m.get(k) || { area: q.area || '', chapter: q.chapter || '', available: 0, total: 0 };
    t.total++;
    if (isEligible(q, history, mode)) t.available++;
    m.set(k, t);
  }
  return m;
}

/**
 * Pick up to `count` questions from the chosen Topic › Sub-topic groups (keys from topics.js). Questions of one passage set stay together (in their PDF order);
 * units are shuffled with `random` (Math.random by default; tests pass their own). Never more
 * than `count`; can be fewer when the sets do not fit exactly or not enough are available.
 * Returns { questionIds, available }.
 */
export function pickQuestions({ questions, history, subject, groups, mode, count, random = Math.random }) {
  const chosen = new Set(groups);
  const eligible = questions
    .filter((q) => q.subject === subject && chosen.has(groupKey(q)) && isEligible(q, history, mode))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.n - b.n));
  const units = [];
  const bySet = new Map();
  for (const q of eligible) {
    if (q.setId) {
      if (!bySet.has(q.setId)) { bySet.set(q.setId, []); units.push(bySet.get(q.setId)); }
      bySet.get(q.setId).push(q);
    } else units.push([q]);
  }
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  const picked = [];
  for (const u of units) if (picked.length + u.length <= count) picked.push(...u);
  return { questionIds: picked.map((q) => q.id), available: eligible.length };
}

export const SUBJECT_SHORT = { 'Quantitative Aptitude': 'Quant', VARC: 'VARC', LRDI: 'LRDI' };

/** The test record for a custom sectional test (a list of question references, model.js). */
export function buildSectionalTest({ id, name, subject, groups, labels, mode, requested, questionIds, questionsById, timeLimitMin, marking, nowIso }) {
  return {
    id,
    schemaVersion: 2,
    kind: 'custom',
    name,
    createdAt: nowIso,
    sourceIds: [...new Set(questionIds.map((qid) => questionsById.get(qid).sourceId))],
    sections: [{ id: 'main', name: subject, subject, style: styleForSubject(subject), questionIds }],
    settings: { timeLimitMin, marking: structuredClone(marking) },
    custom: { subject, groups: [...groups], labels: [...labels], mode, requested },
  };
}
