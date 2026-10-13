// Stage 7c: statistics of full mock tests (pure code, unit-testable in Node). Everything comes
// from what the mock attempt recorded: each section's own clock (attempt.mock.sections), and the
// per-question answers and times already scored by results.js. No percentile, nothing estimated.
import { computeResult } from './results.js';

/** Topic / sub-topic of a mock question until the user tags it. */
export const MOCK_AREA = 'Mock';
export const MOCK_UNTAGGED = 'Not tagged';
export const isUntaggedMock = (q) => (q.area || '') === MOCK_AREA;
export const UNTAGGED_LABEL = 'Mock – not tagged';

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * One row per section of a submitted mock attempt: the section's scores (from computeResult) plus
 * its clock (allotted, used, ended by the user or by time), attempt rate and where the time went.
 * timeOn = { correct, incorrect, skipped } = time spent on questions with that result;
 * unusedMs = allotted time not used (the section was submitted early).
 */
export function mockSectionStats(attempt, result) {
  if (!attempt.mock || !result.scorable) return [];
  return attempt.mock.sections.map((sec) => {
    const s = result.sections.find((x) => x.id === sec.id) || { questions: 0, attempted: 0, correct: 0, incorrect: 0, skipped: 0, score: 0, maxScore: 0, negativeMarks: 0, accuracy: null };
    const rows = result.rows.filter((r) => r.sectionId === sec.id);
    const end = sec.submittedAt ?? attempt.submittedAt ?? sec.endsAt;
    const usedMs = Math.max(0, Math.min(sec.durationMs, end - sec.startedAt));
    const timeOn = { correct: 0, incorrect: 0, skipped: 0 };
    for (const r of rows) timeOn[r.result] += r.timeSpentMs;
    return {
      id: sec.id, name: sec.name,
      questions: s.questions, attempted: s.attempted, correct: s.correct, incorrect: s.incorrect, skipped: s.skipped,
      unseen: rows.filter((r) => r.visits === 0).length,
      score: s.score, maxScore: s.maxScore, negativeMarks: s.negativeMarks, accuracy: s.accuracy,
      attemptRate: pct(s.attempted, s.questions),
      allottedMs: sec.durationMs, usedMs, unusedMs: Math.max(0, sec.durationMs - usedMs),
      endedBy: sec.submittedAt == null ? null : sec.auto ? 'time' : 'you',
      timeOn,
      avgTimePerAttemptMs: s.attempted ? Math.round((timeOn.correct + timeOn.incorrect) / s.attempted) : null,
    };
  });
}

/**
 * Every submitted mock attempt in time order with its per-section numbers, for trends across mocks.
 * attempts: all attempts; questionsById: Map of all questions. Attempts that cannot be scored
 * (a question removed or its key not approved) are left out.
 */
export function mockTrend(attempts, questionsById) {
  const out = [];
  for (const a of attempts) {
    if (a.status !== 'submitted' || !a.mock) continue;
    const result = computeResult(a, questionsById);
    if (!result.scorable) continue;
    out.push({
      attemptId: a.id, testId: a.testId, name: a.snapshot?.name || 'Mock', at: a.submittedAt,
      total: { score: result.overall.score, maxScore: result.overall.maxScore, accuracy: result.overall.accuracy, attemptRate: pct(result.overall.attempted, result.overall.questions) },
      sections: mockSectionStats(a, result),
    });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** How many questions of a mock still carry no topic: { tagged, total }. */
export function taggingProgress(questions) {
  const total = questions.length;
  return { tagged: questions.filter((q) => !isUntaggedMock(q)).length, total };
}
