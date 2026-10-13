// Scoring and result analysis of a submitted attempt (pure code, unit-testable in Node).
// Uses only real data: the approved answer key, the test's marking scheme, and what was recorded
// during the test (answers, time per question, visits). Nothing is estimated or invented.
import { isCorrect } from './exam/scoring.js';

/** Time groups used instead of "difficulty" (the PDFs do not say how hard a question is). */
export const TIME_GROUPS = [
  { id: 'quick', label: 'Under 1 min', maxMs: 60_000 },
  { id: 'medium', label: '1–3 min', maxMs: 180_000 },
  { id: 'long', label: 'Over 3 min', maxMs: Infinity },
];
/** A question counts as "slow" (for the filter) if more than this much time was spent on it. */
export const SLOW_MS = 180_000;

export const timeGroupOf = (ms) => TIME_GROUPS.find((g) => ms < g.maxMs).id;

const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

/**
 * attempt: a submitted attempt (engine state); questionsById: Map(id -> question record).
 * Returns { scorable, problems, rows, sections, overall, topics, subTopics, tags }:
 * topics = by Topic (area, e.g. Arithmetic), subTopics = by Sub-topic (chapter, e.g. Percentage),
 * tags = by the user's own per-question tag.
 * scorable is false (and nothing is scored) if any question's answer key was not approved.
 */
export function computeResult(attempt, questionsById) {
  const marking = attempt.snapshot.settings.marking;
  const problems = [];
  const rows = attempt.questions.map((a, i) => {
    const q = questionsById.get(a.questionId);
    if (!q) {
      problems.push(`Question ${i + 1} is no longer in the library.`);
      return null;
    }
    if (!q.keyApprovedAt) problems.push(`Question ${i + 1}: its answer key was never approved.`);
    const answered = a.answer !== null && a.answer !== undefined && a.answer !== '';
    const correct = answered && isCorrect(q.type, a.answer, q.answer);
    const scheme = q.type === 'MCQ' ? marking.mcq : marking.tita;
    const result = !answered ? 'skipped' : correct ? 'correct' : 'incorrect';
    return {
      index: i,
      number: i + 1,
      questionId: q.id,
      sourceId: q.sourceId,
      sourceNumber: q.n,
      sectionId: a.sectionId,
      subject: q.subject,
      topic: q.topic,
      area: q.area || '',
      chapter: q.chapter || '',
      subTopic: q.subTopic || '',
      type: q.type,
      given: answered ? a.answer : null,
      key: q.answer,
      result,
      marks: result === 'correct' ? scheme.correct : result === 'incorrect' ? scheme.wrong : 0,
      timeSpentMs: a.timeSpentMs || 0,
      visits: a.visits || 0,
      marked: !!a.marked,
      note: a.note || '',
      practiceCheck: a.checked || null,
      history: a.history || [],
      timeGroup: timeGroupOf(a.timeSpentMs || 0),
      slow: (a.timeSpentMs || 0) > SLOW_MS,
    };
  });
  if (problems.length) return { scorable: false, problems, rows: [], sections: [], overall: null, topics: [], subTopics: [], tags: [] };

  const summarise = (list, name, extra = {}) => {
    const attempted = list.filter((r) => r.result !== 'skipped').length;
    const correct = list.filter((r) => r.result === 'correct').length;
    const timeMs = list.reduce((s, r) => s + r.timeSpentMs, 0);
    return {
      name,
      ...extra,
      questions: list.length,
      attempted,
      correct,
      incorrect: attempted - correct,
      skipped: list.length - attempted,
      score: Math.round(list.reduce((s, r) => s + r.marks, 0) * 100) / 100,
      maxScore: list.reduce((s, r) => s + (r.type === 'MCQ' ? marking.mcq.correct : marking.tita.correct), 0),
      negativeMarks: Math.round(list.filter((r) => r.marks < 0).reduce((s, r) => s + r.marks, 0) * 100) / 100,
      accuracy: pct(correct, attempted),
      timeMs,
      avgTimePerAttemptMs: attempted ? Math.round(list.filter((r) => r.result !== 'skipped').reduce((s, r) => s + r.timeSpentMs, 0) / attempted) : null,
    };
  };
  const sections = attempt.snapshot.sections.map((s) => summarise(rows.filter((r) => r.sectionId === s.id), s.name, { id: s.id }));
  const overall = summarise(rows, 'Overall');
  const group = (keyOf, nameOf, keepEmpty) => {
    const keys = [...new Set(rows.map(keyOf))].filter((k) => keepEmpty || k);
    return keys.map((k) => { const list = rows.filter((r) => keyOf(r) === k); return summarise(list, nameOf(list[0]), { key: k }); });
  };
  const area = (r) => (r.area === 'Mock' ? 'Mock – not tagged' : r.area || 'Not set');
  return {
    scorable: true, problems: [], rows, sections, overall,
    topics: group((r) => r.area, area, true),
    subTopics: group((r) => `${r.area}|${r.chapter}`, (r) => (r.area === 'Mock' ? area(r) : `${area(r)} › ${r.chapter || 'Not set'}`), true),
    tags: group((r) => r.subTopic, (r) => r.subTopic, false),
  };
}

/** Per-question records (questionAttempts) with correctness and marks filled in. */
export function scoredRecords(records, result) {
  const byQ = new Map(result.rows.map((r) => [r.questionId, r]));
  return records.map((rec) => {
    const r = byQ.get(rec.questionId);
    return r ? { ...rec, correct: r.result === 'skipped' ? null : r.result === 'correct', marks: r.marks } : rec;
  });
}

/** mm:ss (or h:mm:ss) for durations. */
export function formatDuration(ms) {
  if (ms == null) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
