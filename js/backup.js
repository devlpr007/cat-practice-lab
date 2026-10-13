// Stage 5: backup file format, restore by MERGING (never deletes anything), and the CSV export.
// Pure code (unit-testable in Node); reading / writing IndexedDB is in db.js (dumpAll / applyRestore).
//
// Backup file (JSON, one file with everything needed to restore):
//   { format: 'cat-practice-lab-backup', version: 1, appVersion, exportedAt (ISO), counts,
//     stores: { sources, questions, tests, attempts, questionAttempts, settings },
//     images: [{ id, sourceId, width, height, type, data (base64) }] }
// Merging rules (phone + PC histories can be combined, user decision 7):
//   - anything whose id is not on this device is added;
//   - same id on both: this device's copy is kept, except that an attempt that is newer in the
//     backup (submitted vs still running, or later updatedAt) replaces it together with its
//     per-question records; per-question mistake reasons / notes / re-tries and question tags missing
//     here are filled in from the backup;
//   - settings: only keys missing here are added (the date of the last backup is never copied);
//   - an unfinished attempt is not added if this device has an unfinished attempt of the same test.

export const BACKUP_FORMAT = 'cat-practice-lab-backup';
export const BACKUP_VERSION = 1;
export const STORES = ['sources', 'questions', 'tests', 'attempts', 'questionAttempts', 'settings'];
export const LOCAL_ONLY_SETTINGS = new Set(['lastBackupAt', 'lastBackupInfo']);
/** Settings that belong to this device only and never go into a backup (sync bookkeeping too). */
export const isLocalOnlySetting = (key) => LOCAL_ONLY_SETTINGS.has(key) || String(key).startsWith('sync.');
/** Reminder after this many days without a backup. */
export const REMIND_AFTER_DAYS = 7;

const keyOf = (store, r) => (store === 'settings' ? r.key : r.id);

/** Problems with a parsed backup file (empty list = usable). */
export function backupProblems(data) {
  if (!data || typeof data !== 'object') return ['This file is not a CAT Practice Lab backup.'];
  if (data.format !== BACKUP_FORMAT) return ['This file is not a CAT Practice Lab backup.'];
  if (!Number.isInteger(data.version) || data.version > BACKUP_VERSION) return [`This backup was made by a newer version of the app (format ${data.version}). Please update the app first.`];
  const p = [];
  for (const s of STORES) {
    if (!Array.isArray(data.stores?.[s])) p.push(`The backup is damaged: part "${s}" is missing.`);
    else if (data.stores[s].some((r) => !r || typeof r !== 'object' || keyOf(s, r) == null)) p.push(`The backup is damaged: a record in "${s}" has no id.`);
  }
  if (!Array.isArray(data.images)) p.push('The backup is damaged: the pictures are missing.');
  else if (data.images.some((im) => !im || !im.id || typeof im.data !== 'string')) p.push('The backup is damaged: a picture has no data.');
  return p;
}

const newer = (a, b) => (a.status === 'submitted' && b.status !== 'submitted') || (a.status === b.status && (a.updatedAt || 0) > (b.updatedAt || 0));

/**
 * Work out what a restore would write. existing / incoming: { store: [records] } (+ images as
 * arrays of { id }). Returns { put: { store: [records] }, images: [ids to add], summary }.
 */
export function planMerge(existing, incoming) {
  const put = Object.fromEntries(STORES.map((s) => [s, []]));
  const summary = Object.fromEntries(STORES.map((s) => [s, { added: 0, updated: 0, kept: 0 }]));
  const have = Object.fromEntries(STORES.map((s) => [s, new Map((existing[s] || []).map((r) => [keyOf(s, r), r]))]));

  // attempts first: replaced attempts take their per-question records along
  const replaced = new Set();
  const skipped = new Set();
  // a test has at most one unfinished attempt: an unfinished one from the backup is not added
  // when this device already has an unfinished attempt of the same test
  // (attempts the backup brings up to date are decided first, so the result does not depend on order)
  const finishedThere = new Set((incoming.attempts || []).filter((a) => have.attempts.has(a.id) && newer(a, have.attempts.get(a.id)) && a.status === 'submitted').map((a) => a.id));
  const running = new Set((existing.attempts || []).filter((x) => x.status === 'in-progress' && !finishedThere.has(x.id)).map((x) => x.testId));
  for (const a of incoming.attempts || []) {
    const mine = have.attempts.get(a.id);
    if (!mine && a.status === 'in-progress' && running.has(a.testId)) { skipped.add(a.id); summary.attempts.kept++; continue; }
    if (!mine) { put.attempts.push(a); summary.attempts.added++; if (a.status === 'in-progress') running.add(a.testId); } else if (newer(a, mine)) { put.attempts.push(a); replaced.add(a.id); summary.attempts.updated++; } else summary.attempts.kept++;
  }
  for (const r of incoming.questionAttempts || []) {
    const mine = have.questionAttempts.get(r.id);
    if (skipped.has(r.attemptId)) continue;
    if (!mine) { put.questionAttempts.push(r); summary.questionAttempts.added++; continue; }
    if (replaced.has(r.attemptId)) { put.questionAttempts.push(r); summary.questionAttempts.updated++; continue; }
    const merged = { ...mine };
    let changed = false;
    if (r.mistakeReason && (!mine.mistakeReason || (r.mistakeReason.at || 0) > (mine.mistakeReason.at || 0))) { merged.mistakeReason = r.mistakeReason; changed = true; }
    if (r.note && !mine.note) { merged.note = r.note; changed = true; }
    const tries = new Map((mine.reattempts || []).map((x) => [x.at, x]));
    for (const x of r.reattempts || []) if (!tries.has(x.at)) { tries.set(x.at, x); changed = true; }
    if (changed) {
      merged.reattempts = [...tries.values()].sort((x, y) => x.at - y.at);
      put.questionAttempts.push(merged);
      summary.questionAttempts.updated++;
    } else summary.questionAttempts.kept++;
  }
  for (const q of incoming.questions || []) {
    const mine = have.questions.get(q.id);
    if (!mine) { put.questions.push(q); summary.questions.added++; } else if (q.subTopic && !mine.subTopic) { put.questions.push({ ...mine, subTopic: q.subTopic }); summary.questions.updated++; } else summary.questions.kept++;
  }
  for (const s of ['sources', 'tests']) {
    for (const r of incoming[s] || []) {
      if (!have[s].has(r.id)) { put[s].push(r); summary[s].added++; } else summary[s].kept++;
    }
  }
  for (const r of incoming.settings || []) {
    if (isLocalOnlySetting(r.key)) continue;
    if (!have.settings.has(r.key)) { put.settings.push(r); summary.settings.added++; } else summary.settings.kept++;
  }
  const haveImages = new Set((existing.images || []).map((im) => im.id));
  const images = (incoming.images || []).filter((im) => !haveImages.has(im.id)).map((im) => im.id);
  return { put, images, summary };
}

/** One line per number for the restore message. */
export function mergeSummaryText(plan) {
  const s = plan.summary;
  const tests = s.tests.added;
  const attempts = s.attempts.added + s.attempts.updated;
  const lines = [
    `${tests} test(s) and ${s.questions.added} question(s) added, ${plan.images.length} picture(s).`,
    `${attempts} attempt(s) added or brought up to date; ${s.attempts.kept} already here were kept.`,
  ];
  if (s.questionAttempts.updated) lines.push(`${s.questionAttempts.updated} answer record(s) got mistake reasons, notes or re-tries from the backup.`);
  if (s.tests.kept) lines.push(`${s.tests.kept} test(s) were already on this device and were left as they are.`);
  return lines;
}

/** Days since the last backup (null = never). */
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  return Math.floor((now - Date.parse(iso)) / 86_400_000);
}

export function needsReminder(lastBackupAt, hasData, now = Date.now()) {
  if (!hasData) return false;
  const d = daysSince(lastBackupAt, now);
  return d === null || d >= REMIND_AFTER_DAYS;
}

// ---------- CSV (one row per question per submitted attempt, for spreadsheets) ----------

export const CSV_COLUMNS = ['Date', 'Test', 'Test type', 'Mode', 'Subject', 'Topic', 'Sub-topic', 'PDF heading', 'PDF', 'Question no. in PDF',
  'Position in test', 'Type', 'Your answer', 'Correct answer', 'Result', 'Marks', 'Time (seconds)', 'Visits', 'Marked for review',
  'Mistake reason', 'Mistake note', 'Your tag', 'Your note'];

export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text (with a BOM so Excel reads the ₹ / – characters right). */
export function answersCsv({ attempts, records, questions, sources, tests, reasonLabel = (c) => c }) {
  const qById = new Map(questions.map((q) => [q.id, q]));
  const sById = new Map(sources.map((s) => [s.id, s]));
  const tById = new Map(tests.map((t) => [t.id, t]));
  const aById = new Map(attempts.filter((a) => a.status === 'submitted').map((a) => [a.id, a]));
  const rows = [];
  for (const r of records) {
    const a = aById.get(r.attemptId);
    if (!a) continue;
    const q = qById.get(r.questionId) || {};
    const pos = a.questions.findIndex((x) => x.questionId === r.questionId) + 1;
    const result = r.correct === true ? 'correct' : r.correct === false ? 'wrong' : r.answer == null ? (r.visits ? 'skipped' : 'not opened') : 'not scored';
    rows.push({ at: a.submittedAt, pos, cells: [
      new Date(a.submittedAt).toISOString().slice(0, 16).replace('T', ' '),
      a.snapshot?.name || tById.get(a.testId)?.name || '', tById.get(a.testId)?.kind === 'custom' ? 'sectional' : 'DPP', a.mode || 'exam',
      q.subject, q.area, q.chapter, q.topic, sById.get(q.sourceId)?.fileName, q.n, pos, q.type,
      r.answer, q.answer, result, r.marks, Math.round((r.timeSpentMs || 0) / 1000), r.visits, r.markedForReview ? 'yes' : 'no',
      r.mistakeReason ? reasonLabel(r.mistakeReason.code) : '', r.mistakeReason?.note || '', q.subTopic || '', r.note || '',
    ] });
  }
  rows.sort((x, y) => x.at - y.at || x.pos - y.pos);
  return '﻿' + [CSV_COLUMNS, ...rows.map((x) => x.cells)].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- base64 for picture data ----------

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
