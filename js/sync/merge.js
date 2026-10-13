// Stage 8: how two copies of the user's data are combined (pure code, unit-testable in Node).
// The rules the user agreed to (CLAUDE.md decision 26):
//   - attempts are never overwritten: every submitted attempt has its own id and both sides keep all
//     of them; a submitted attempt beats an unfinished copy; an unfinished attempt stays on the device
//     that started it (it is not synced);
//   - things the user can change later (topic / sub-topic of a PDF or question, the user's own tag,
//     a test's time limit, mistake reasons, settings): the most recent change wins, field by field;
//     the value that lost is kept for 30 days in "changes from other devices";
//   - re-tries on a result page are added up from both sides;
//   - nothing is deleted by a merge. A deletion on one device reaches the other one as a question
//     ("Deleted on your other device — remove here too?").
//
// Change times: every later change stamps the record with `_at: { field: ms }` (db.js). Records that
// were never changed have no stamp (time 0), so any real change wins over them.

/** Fields of each kind of record that can change after it was first saved. */
export const MUTABLE = {
  sources: ['area', 'chapter'],
  questions: ['area', 'chapter', 'subTopic'],
  tests: ['settings'],
};
/** Settings that stay on one device (never synced). */
export const DEVICE_SETTINGS = new Set(['lastBackupAt', 'lastBackupInfo', 'game.reduceEffects', 'game.sound', 'game.ambient', 'game.rankShown', 'game.bossesShown', 'firstRunSeen']);
export const isDeviceSetting = (key) => DEVICE_SETTINGS.has(key) || String(key).startsWith('sync.');
/** How long a value replaced by another device's newer change is remembered. */
export const KEEP_REPLACED_MS = 30 * 24 * 3600 * 1000;

const at = (r, field) => (r && r._at && r._at[field]) || 0;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Merge two copies of one record, field by field for the fields that can change.
 * Returns { record, replaced: [{ field, value, by }] } — `replaced` lists values on THIS side that
 * lost to a newer change from the other side (for "changes from other devices").
 */
export function mergeRecord(mine, theirs, fields) {
  if (!mine) return { record: theirs, replaced: [] };
  if (!theirs) return { record: mine, replaced: [] };
  const record = { ...mine };
  const replaced = [];
  const stamps = { ...(mine._at || {}) };
  for (const f of fields) {
    const a = at(mine, f);
    const b = at(theirs, f);
    if (b > a && !same(mine[f], theirs[f])) {
      replaced.push({ field: f, value: mine[f] ?? null, by: theirs[f] ?? null, at: b });
      record[f] = theirs[f];
      stamps[f] = b;
    } else if (b > a) stamps[f] = b;
  }
  if (Object.keys(stamps).length) record._at = stamps;
  return { record, replaced };
}

/** One per-question attempt record: mistake reason (latest wins), re-tries (added up). */
export function mergeQuestionAttempt(mine, theirs) {
  if (!mine) return { record: theirs, replaced: [] };
  if (!theirs) return { record: mine, replaced: [] };
  const record = { ...mine };
  const replaced = [];
  const ma = mine.mistakeReason?.at || 0;
  const ta = theirs.mistakeReason?.at || 0;
  if (ta > ma && !same(mine.mistakeReason, theirs.mistakeReason)) {
    if (mine.mistakeReason) replaced.push({ field: 'mistakeReason', value: mine.mistakeReason, by: theirs.mistakeReason, at: ta });
    record.mistakeReason = theirs.mistakeReason;
  }
  const tries = new Map((mine.reattempts || []).map((x) => [x.at, x]));
  for (const x of theirs.reattempts || []) if (!tries.has(x.at)) tries.set(x.at, x);
  if (tries.size) record.reattempts = [...tries.values()].sort((x, y) => x.at - y.at);
  return { record, replaced };
}

/**
 * An attempt with its per-question records. Only submitted attempts are synced; the same attempt
 * on both sides is the same test sitting, so only the per-question extras can differ.
 */
export function mergeAttemptBundle(mine, theirs) {
  if (!mine) return { bundle: theirs, replaced: [] };
  if (!theirs) return { bundle: mine, replaced: [] };
  const attempt = mine.attempt.status === 'submitted' || theirs.attempt.status !== 'submitted' ? mine.attempt : theirs.attempt;
  const byId = new Map(mine.records.map((r) => [r.id, r]));
  const replaced = [];
  for (const r of theirs.records) {
    const m = mergeQuestionAttempt(byId.get(r.id), r);
    byId.set(r.id, m.record);
    replaced.push(...m.replaced.map((x) => ({ ...x, recordId: r.id })));
  }
  return { bundle: { attempt, records: [...byId.values()] }, replaced };
}

/** A PDF (source) with its questions. Pictures never change, so they are not merged here. */
export function mergeSourceBundle(mine, theirs) {
  if (!mine) return { bundle: theirs, replaced: [] };
  if (!theirs) return { bundle: mine, replaced: [] };
  const s = mergeRecord(mine.source, theirs.source, MUTABLE.sources);
  const byId = new Map(mine.questions.map((q) => [q.id, q]));
  const replaced = s.replaced.map((x) => ({ ...x, kind: 'source', id: mine.source.id }));
  for (const q of theirs.questions) {
    const m = mergeRecord(byId.get(q.id), q, MUTABLE.questions);
    byId.set(q.id, m.record);
    replaced.push(...m.replaced.map((x) => ({ ...x, kind: 'question', id: q.id })));
  }
  return { bundle: { source: s.record, questions: [...byId.values()] }, replaced };
}

/** All tests (DPP, mock, sectional): union by id, the time limit merged by change time. */
export function mergeTests(mine, theirs) {
  const byId = new Map(mine.map((t) => [t.id, t]));
  const replaced = [];
  for (const t of theirs) {
    const m = mergeRecord(byId.get(t.id), t, MUTABLE.tests);
    byId.set(t.id, m.record);
    replaced.push(...m.replaced.map((x) => ({ ...x, kind: 'test', id: t.id })));
  }
  return { tests: [...byId.values()], replaced };
}

/** Settings: per key, the later change wins (rows are { key, value, at }); device settings are left out. */
export function mergeSettings(mine, theirs) {
  const byKey = new Map(mine.filter((r) => !isDeviceSetting(r.key)).map((r) => [r.key, r]));
  const replaced = [];
  for (const r of theirs) {
    if (isDeviceSetting(r.key)) continue;
    const m = byKey.get(r.key);
    if (!m || (r.at || 0) > (m.at || 0)) {
      if (m && !same(m.value, r.value)) replaced.push({ kind: 'setting', id: r.key, field: 'value', value: m.value, by: r.value, at: r.at || 0 });
      byKey.set(r.key, r);
    }
  }
  return { settings: [...byKey.values()], replaced };
}

/**
 * Deletions: { kind: 'test', id, name, at, keptAt? }. A deletion is "open" on a device that still
 * has the test until the user answers: remove it here too (the test goes), or keep it (keptAt is
 * set; the test returns to the account and the deletion is closed everywhere).
 */
export function mergeTombstones(mine, theirs) {
  const key = (t) => `${t.kind}:${t.id}`;
  const byKey = new Map(mine.map((t) => [key(t), t]));
  for (const t of theirs) {
    const m = byKey.get(key(t));
    if (!m) { byKey.set(key(t), t); continue; }
    byKey.set(key(t), { ...m, at: Math.max(m.at || 0, t.at || 0), keptAt: Math.max(m.keptAt || 0, t.keptAt || 0) || undefined, name: m.name || t.name });
  }
  return [...byKey.values()];
}
export const isOpenDeletion = (t) => !t.keptAt || t.keptAt < t.at;

/** "Changes from other devices": add new entries, forget those older than 30 days. */
export function addReplaced(log, entries, now) {
  const fresh = log.filter((x) => now - (x.loggedAt || 0) < KEEP_REPLACED_MS);
  return [...fresh, ...entries.map((e) => ({ ...e, loggedAt: now }))];
}
