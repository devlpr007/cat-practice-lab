// Records for a mock test (pure code, unit-testable): one source (the PDF), one independent
// question per item (subject from its section; Topic "Mock" / Sub-topic "Not tagged" until the user
// tags it on the results page), and one test of kind 'mock' with the three CAT sections in order.
import { SCHEMA_VERSION, sourceIdFromSha, questionId, imageId, styleForSubject } from './model.js';
import { answerKind } from './parser/validate.js';
import { cleanAnswer, settingsProblems } from './test-record.js';

export const MOCK_SECTION_MINUTES = 40;
export const MOCK_AREA = 'Mock';
export const MOCK_CHAPTER = 'Not tagged';

/** Suggested name from the file name: "CAT 2025 Slot 1 Question Paper.pdf" -> "CAT 2025 Slot 1". */
export function mockNameFromFile(fileName) {
  // the user's mock names must not carry the provider's name or boilerplate ("Question Paper",
  // "by Cracku", "with solutions", "(1)" download copies, "pdf" leftovers)
  return String(fileName || '')
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\bby\s+cracku\b/gi, ' ').replace(/\bcracku\b/gi, ' ')
    .replace(/\b(question\s*paper|answer\s*key|with\s+(detailed\s+)?(solutions?|answers?|explanations?)|solutions?|explanations?|pdf|qp)\b/gi, ' ')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\s*[-\u2013]\s*[-\u2013]\s*/g, ' - ')
    .replace(/^[\s\-\u2013]+|[\s\-\u2013]+$/g, '')
    .replace(/\s+/g, ' ').trim() || 'Mock test';
}

/** The mock test's id: shares the PDF's fingerprint, so the same PDF cannot be added twice. */
export const mockTestIdFromSha = (sha256) => 'm-' + sha256.slice(0, 24);

/**
 * draft: the mock reader's draft after review; form: { name, sectionMinutes, marking }.
 * Returns { source, questions, test, images } for db.saveImport(). Throws if not complete.
 */
export function buildMockRecords(draft, form, nowIso, keyApprovedAtIso) {
  if (!keyApprovedAtIso) throw new Error('The answer key must be approved before saving.');
  const problems = settingsProblems({ timeLimitMin: form.sectionMinutes, marking: form.marking });
  if (problems.length) throw new Error(problems.join(' '));
  const sourceId = sourceIdFromSha(draft.file.sha256);
  const used = new Set();
  const ref = (cropId) => {
    if (!cropId) return null;
    if (!draft.images[cropId]) throw new Error(`Missing picture ${cropId}.`);
    used.add(cropId);
    return imageId(sourceId, cropId);
  };
  const name = (form.name || '').trim() || mockNameFromFile(draft.file.name);
  const sectionOf = new Map(draft.sections.map((s) => [s.key, s]));
  const questions = draft.questions.map((q) => {
    const type = answerKind(q.answer.value);
    if (!type) throw new Error(`Q${q.n} has no valid answer.`);
    const sec = sectionOf.get(q.section);
    if (!sec) throw new Error(`Q${q.n} is in no section.`);
    const separate = type === 'MCQ' && q.optionsMode === 'separate' && q.images.options;
    const flags = (q.issues || []).map((i) => i.text);
    if (type === 'MCQ' && !separate) flags.push('Options are shown inside the question picture (not cut out one by one).');
    return {
      id: questionId(sourceId, q.n),
      schemaVersion: SCHEMA_VERSION,
      sourceId,
      n: q.n,
      subject: sec.subject,
      topic: name,
      area: MOCK_AREA,
      chapter: MOCK_CHAPTER,
      subTopic: '',
      type,
      answer: cleanAnswer(q.answer.value),
      answerDetected: q.answer.detected,
      answerEditedByUser: !!q.answer.edited,
      keyApprovedAt: keyApprovedAtIso,
      optionsMode: type === 'MCQ' ? (separate ? 'separate' : 'fallback') : 'none',
      stemHeight: separate ? q.stemHeight : null,
      images: {
        question: ref(q.images.question),
        options: separate ? Object.fromEntries(['A', 'B', 'C', 'D'].map((L) => [L, ref(q.images.options[L])])) : null,
        solution: ref(q.images.solution),
        keyStrip: ref(q.images.keyStrip || null),
        passage: ref(q.images.passage || null),
      },
      setId: q.setId ? `${sourceId}/${q.setId}` : null,
      mockSection: q.section,
      flags,
      createdAt: nowIso,
    };
  });
  const source = {
    id: sourceId,
    schemaVersion: SCHEMA_VERSION,
    kind: draft.kind === 'text' ? 'text' : 'shape',
    format: 'mock',
    fileName: draft.file.name,
    fileSize: draft.file.size,
    sha256: draft.file.sha256,
    pages: draft.file.pages,
    parserVersion: draft.parserVersion,
    pdfjsVersion: draft.pdfjsVersion,
    renderScale: draft.renderScale,
    name,
    subject: 'Mock',
    topic: name,
    area: MOCK_AREA,
    chapter: MOCK_CHAPTER,
    dpp: null,
    createdAt: nowIso,
    keyApproval: { approvedAt: keyApprovedAtIso, editedCount: questions.filter((q) => q.answerEditedByUser).length },
    headerImage: null,
    warnings: [...(draft.warnings || [])],
    questionIds: questions.map((q) => q.id),
  };
  const sections = draft.sections.map((s) => ({
    id: s.key,
    name: s.display,
    subject: s.subject,
    style: styleForSubject(s.subject),
    questionIds: questions.filter((q) => q.mockSection === s.key).map((q) => q.id),
    timeLimitMin: Number(form.sectionMinutes),
  }));
  const test = {
    id: mockTestIdFromSha(draft.file.sha256),
    schemaVersion: SCHEMA_VERSION,
    kind: 'mock',
    name,
    createdAt: nowIso,
    sourceIds: [sourceId],
    sections,
    settings: {
      timeLimitMin: Number(form.sectionMinutes) * sections.length,
      marking: {
        mcq: { correct: Number(form.marking.mcq.correct), wrong: Number(form.marking.mcq.wrong) },
        tita: { correct: Number(form.marking.tita.correct), wrong: Number(form.marking.tita.wrong) },
      },
    },
    mock: { sectionMinutes: Number(form.sectionMinutes), lockedOrder: true },
  };
  const images = [...used].map((cropId) => ({
    id: imageId(sourceId, cropId),
    sourceId,
    blob: draft.images[cropId].blob,
    width: draft.images[cropId].width,
    height: draft.images[cropId].height,
  }));
  return { source, questions, test, images };
}
