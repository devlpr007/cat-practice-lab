// Building stored records (see model.js) from a reviewed draft, and converting records saved by
// the first version of the app (pure code, unit-testable in Node).
import { answerKind } from './parser/validate.js';
import { classifyTopic } from './topics.js';
import {
  SCHEMA_VERSION, sourceIdFromSha, pdfTestIdFromSha, questionId, imageId, styleForSubject,
} from './model.js';

export const DEFAULT_SETTINGS = {
  timeLimitMin: 60,
  marking: { mcq: { correct: 3, wrong: -1 }, tita: { correct: 3, wrong: 0 } },
};

/** The answer as stored: letters upper-case, numbers exactly as read/typed (only trimmed). */
export function cleanAnswer(value) {
  const v = String(value ?? '').trim();
  return answerKind(v) === 'MCQ' ? v.toUpperCase() : v;
}

const cleanSettings = (form) => ({
  timeLimitMin: Number(form.timeLimitMin),
  marking: {
    mcq: { correct: Number(form.marking.mcq.correct), wrong: Number(form.marking.mcq.wrong) },
    tita: { correct: Number(form.marking.tita.correct), wrong: Number(form.marking.tita.wrong) },
  },
});

/**
 * draft: the parser's draft after review (answers possibly edited by the user)
 * form: { subject, topic, area, chapter, name, timeLimitMin, marking }
 *   (area = Topic such as Arithmetic, chapter = Sub-topic such as Percentage; see topics.js)
 * Returns { source, questions, test, images } for db.saveImport(). Throws if not complete.
 */
export function buildRecords(draft, form, nowIso, keyApprovedAtIso) {
  if (!keyApprovedAtIso) throw new Error('The answer key must be approved before saving.');
  const sourceId = sourceIdFromSha(draft.file.sha256);
  const topic = form.topic.trim();
  const area = (form.area || '').trim();
  const chapter = (form.chapter || '').trim();
  const used = new Set();
  const ref = (cropId) => {
    if (!cropId) return null;
    if (!draft.images[cropId]) throw new Error(`Missing picture ${cropId}.`);
    used.add(cropId);
    return imageId(sourceId, cropId);
  };
  const questions = draft.questions.map((q) => {
    const type = answerKind(q.answer.value);
    if (!type) throw new Error(`Q${q.n} has no valid answer.`);
    const separate = type === 'MCQ' && q.optionsMode === 'separate' && q.images.options;
    const flags = (q.issues || []).map((i) => i.text);
    if (type === 'MCQ' && !separate) flags.push('Options are shown inside the question picture (not cut out one by one).');
    return {
      id: questionId(sourceId, q.n),
      schemaVersion: SCHEMA_VERSION,
      sourceId,
      n: q.n,
      subject: form.subject,
      topic,
      area,
      chapter,
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
        keyStrip: ref(q.images.keyStrip),
        passage: ref(q.images.passage || null),
      },
      setId: q.setId ? `${sourceId}/${q.setId}` : null,
      flags,
      createdAt: nowIso,
    };
  });
  const name = (form.name || '').trim() || topic;
  const source = {
    id: sourceId,
    schemaVersion: SCHEMA_VERSION,
    fileName: draft.file.name,
    fileSize: draft.file.size,
    sha256: draft.file.sha256,
    pages: draft.file.pages,
    kind: draft.kind,
    parserVersion: draft.parserVersion,
    pdfjsVersion: draft.pdfjsVersion,
    renderScale: draft.renderScale,
    name,
    subject: form.subject,
    topic,
    area,
    chapter,
    dpp: draft.header.dpp || null,
    createdAt: nowIso,
    keyApproval: { approvedAt: keyApprovedAtIso, editedCount: questions.filter((q) => q.answerEditedByUser).length },
    headerImage: ref(draft.header.image),
    warnings: [...(draft.warnings || [])],
    questionIds: questions.map((q) => q.id),
  };
  const test = {
    id: pdfTestIdFromSha(draft.file.sha256),
    schemaVersion: SCHEMA_VERSION,
    kind: 'pdf',
    name,
    createdAt: nowIso,
    sourceIds: [sourceId],
    sections: [{ id: 'main', name: form.subject, subject: form.subject, style: styleForSubject(form.subject), questionIds: source.questionIds }],
    settings: cleanSettings(form),
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

/**
 * Convert a test saved by app version 0.1 (schema 1: questions inside the test, image ids
 * '<testId>/<cropId>') into schema-2 records. Nothing is dropped.
 * Returns { source, questions, test, imageIds: Map(oldImageId -> newImageId), sourceId }.
 */
export function migrateV1Test(t) {
  const sourceId = sourceIdFromSha(t.source.sha256);
  const newImg = (oldId) => (oldId ? imageId(sourceId, oldId.slice(oldId.indexOf('/') + 1)) : null);
  const imageIds = new Map();
  const track = (oldId) => { const n = newImg(oldId); if (oldId) imageIds.set(oldId, n); return n; };
  const { area, chapter } = classifyTopic(t.subject, t.source.fileName, t.topic);
  const questions = t.questions.map((q) => ({
    id: questionId(sourceId, q.n),
    schemaVersion: SCHEMA_VERSION,
    sourceId,
    n: q.n,
    subject: t.subject,
    topic: t.topic,
    area,
    chapter,
    subTopic: q.subTopic || '',
    type: q.type,
    answer: q.answer,
    answerDetected: q.answerDetected,
    answerEditedByUser: !!q.answerEditedByUser,
    keyApprovedAt: t.keyApproval?.approvedAt || null,
    optionsMode: q.optionsMode,
    stemHeight: q.stemHeight,
    images: {
      question: track(q.images.question),
      options: q.images.options ? Object.fromEntries(Object.entries(q.images.options).map(([L, id]) => [L, track(id)])) : null,
      solution: track(q.images.solution),
      keyStrip: track(q.images.keyStrip),
    },
    flags: q.flags || [],
    createdAt: t.createdAt,
  }));
  const source = {
    id: sourceId,
    schemaVersion: SCHEMA_VERSION,
    fileName: t.source.fileName,
    fileSize: t.source.fileSize,
    sha256: t.source.sha256,
    pages: t.source.pages,
    kind: t.source.kind,
    parserVersion: t.source.parserVersion,
    pdfjsVersion: t.source.pdfjsVersion,
    renderScale: t.source.renderScale,
    name: t.name,
    subject: t.subject,
    topic: t.topic,
    area,
    chapter,
    dpp: t.dpp || null,
    createdAt: t.createdAt,
    keyApproval: t.keyApproval,
    headerImage: track(t.headerImage),
    warnings: t.warnings || [],
    questionIds: questions.map((q) => q.id),
  };
  const test = {
    id: t.id,
    schemaVersion: SCHEMA_VERSION,
    kind: 'pdf',
    name: t.name,
    createdAt: t.createdAt,
    sourceIds: [sourceId],
    sections: [{ id: 'main', name: t.subject, subject: t.subject, style: t.style || styleForSubject(t.subject), questionIds: source.questionIds }],
    settings: t.settings,
  };
  return { source, questions, test, imageIds, sourceId };
}

/** Check a settings form (time and marks). Returns a list of problems (empty = fine). */
export function settingsProblems(s) {
  const out = [];
  const t = Number(s.timeLimitMin);
  if (!Number.isFinite(t) || t < 1 || t > 600 || Math.round(t) !== t) out.push('Time limit must be a whole number of minutes between 1 and 600.');
  for (const [kind, label] of [['mcq', 'MCQ'], ['tita', 'TITA']]) {
    const c = Number(s.marking?.[kind]?.correct);
    const w = Number(s.marking?.[kind]?.wrong);
    if (!Number.isFinite(c) || c <= 0 || c > 100) out.push(`${label} marks for a correct answer must be a positive number.`);
    if (!Number.isFinite(w) || w > 0 || w < -100) out.push(`${label} marks for a wrong answer must be zero or negative (for example -1).`);
  }
  return out;
}
