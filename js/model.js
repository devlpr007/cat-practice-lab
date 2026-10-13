// The data model (schema version 2). Every question is an independent item; a test is only a list
// of question references, grouped in sections. This allows tests mixing many PDFs/topics and
// sectional tests later without changing how questions are stored.
//
// sources          one per imported PDF
//   { id: 's-<sha256[0..24]>', schemaVersion, fileName, fileSize, sha256, pages, kind ('text'|'shape'),
//     parserVersion, pdfjsVersion, renderScale, name, subject, topic, area, chapter, dpp, createdAt,
//     keyApproval: { approvedAt, editedCount }, headerImage, warnings, questionIds }
// questions        one per question, independent of any test
//   { id: '<sourceId>/q<n>', schemaVersion, sourceId, n (question number in the PDF), subject, topic
//     (as printed in the PDF heading), area (Topic: Arithmetic, ..., VA, RC, DI, LR; '' = not set),
//     chapter (Sub-topic: Percentage, ...; see topics.js), subTopic (the user's own tag, '' until set), type ('MCQ'|'TITA'), answer (as read/typed), answerDetected,
//     answerEditedByUser, keyApprovedAt (never score a question without it), optionsMode
//     ('separate'|'fallback'|'none'), stemHeight, images: { question, options: {A..D}|null, solution,
//     keyStrip, passage? }, flags: [text], createdAt,
//     setId? (VARC/LRDI: questions sharing one passage/data set have the same setId and passage picture) }
// images           picture Blobs: { id: '<sourceId>/<cropId>', sourceId, blob, width, height }
// tests            a list of question references
//   { id, schemaVersion, kind ('pdf' = one PDF in its own order; 'custom' = sectional test the user
//     built from chosen topics, see sectional.js), name, createdAt,
//     sourceIds, sections: [{ id, name, subject, style ('A'|'B'), questionIds, timeLimitMin? }],
//     settings: { timeLimitMin, marking: { mcq: { correct, wrong }, tita: { correct, wrong } } },
//     custom?: { subject, topics, mode ('new'|'weak'), requested },
//     kind 'mock' (Stage 7, one CAT mock PDF): three sections varc / dilr / qa in fixed order, each with
//     timeLimitMin; mock: { sectionMinutes, lockedOrder } }
// attempts         one per attempt of a test; the live state of the exam engine (exam/engine.js)
//   { id, testId, startedAt, endsAt (absolute end time), durationMs, timerDirection, submittedAt,
//     status ('in-progress'|'submitted'), autoSubmitted, current, lastTick,
//     snapshot: { name, sections, settings } (the test as it was when attempted),
//     questions: [{ questionId, sectionId, answer, marked, visits, timeSpentMs, history }], updatedAt }
// questionAttempts one per question per attempt (Stage 3)
//   { id: '<attemptId>/<questionId>', attemptId, testId, questionId, sourceId, answer (null = skipped),
//     correct (true|false|null), marks, timeSpentMs, visits, markedForReview,
//     history: [{ at, answer }], mistakeReason: null | { code, note, at } }
// settings         { key, value }

export const SCHEMA_VERSION = 2;

/** Mistake reasons the user can attach to a question attempt after a test (list can grow later). */
export const MISTAKE_REASONS = [
  { code: 'careless', label: 'Careless error' },
  { code: 'concept', label: 'Concept gap' },
  { code: 'misread', label: 'Misread the question' },
  { code: 'time', label: 'Time pressure' },
  { code: 'trap', label: 'Fell for a trap' },
  { code: 'other', label: 'Other' },
];

export const sourceIdFromSha = (sha256) => 's-' + sha256.slice(0, 24);
/** The test made directly from one PDF shares the PDF's fingerprint, so duplicates are found. */
export const pdfTestIdFromSha = (sha256) => 't-' + sha256.slice(0, 24);
export const questionId = (sourceId, n) => `${sourceId}/q${n}`;
export const imageId = (sourceId, cropId) => `${sourceId}/${cropId}`;

/** Quantitative Aptitude uses screen style A; VARC and LRDI use style B (passage + question). */
export function styleForSubject(subject) {
  return subject === 'Quantitative Aptitude' ? 'A' : 'B';
}

/** All question ids of a test, in order. */
export function testQuestionIds(test) {
  return test.sections.flatMap((s) => s.questionIds);
}
