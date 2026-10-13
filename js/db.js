// On-device storage (IndexedDB, inside the browser). Nothing is ever sent anywhere.
// Record layouts are described in model.js.
//
// Version history of the database "cat-practice-lab":
//   1 (app 0.1): tests (with their questions inside), images (by testId), attempts, settings
//   2: sources, questions (independent items), images (by sourceId), tests (lists of question ids),
//      attempts, questionAttempts, settings. Version-1 tests are converted on first start; nothing is lost.
import { migrateV1Test } from './test-record.js';
import { testQuestionIds } from './model.js';
import { classifyTopic } from './topics.js';

const BASE_NAME = 'cat-practice-lab';
const DB_VERSION = 2;

// Stage 8: each Google account signed in on this device has its own database
// ("cat-practice-lab@<account key>"); without sign-in the app uses "cat-practice-lab" as before.
let DB_NAME = BASE_NAME;
let dbPromise = null;

export const databaseNameFor = (accountKey) => (accountKey ? `${BASE_NAME}@${accountKey}` : BASE_NAME);
export const currentDatabaseName = () => DB_NAME;

/** Switch to the database of an account (null = this device without sign-in). */
export async function useDatabase(accountKey) {
  const name = databaseNameFor(accountKey);
  if (name === DB_NAME) return;
  if (dbPromise) { try { (await dbPromise).close(); } catch { /* already closed */ } }
  dbPromise = null;
  DB_NAME = name;
}

/** Remove a whole account database from this device (only after the user chose so at sign-out). */
export async function deleteDatabase(accountKey) {
  const name = databaseNameFor(accountKey);
  if (!accountKey) throw new Error('The device database is never deleted this way.');
  if (name === DB_NAME) await useDatabase(null);
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Change stamp for fields edited after a record was first saved (used by sync, merge.js). */
const stamp = (record, fields, now = Date.now()) => ({ ...record, _at: { ...(record._at || {}), ...Object.fromEntries(fields.map((f) => [f, now])) } });

function upgrade(db, tx, oldVersion) {
  const ensure = (name, keyPath, indexes = []) => {
    const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath });
    for (const ix of indexes) if (!store.indexNames.contains(ix)) store.createIndex(ix, ix);
    return store;
  };
  ensure('sources', 'id');
  ensure('questions', 'id', ['sourceId', 'subject', 'topic']);
  const images = ensure('images', 'id');
  if (images.indexNames.contains('testId')) images.deleteIndex('testId');
  if (!images.indexNames.contains('sourceId')) images.createIndex('sourceId', 'sourceId');
  const tests = ensure('tests', 'id');
  ensure('attempts', 'id', ['testId']);
  ensure('questionAttempts', 'id', ['attemptId', 'questionId', 'testId']);
  ensure('settings', 'key');

  if (oldVersion === 1) {
    // convert version-1 tests (questions stored inside the test) into sources + questions + tests
    tests.getAll().onsuccess = (e) => {
      const renamed = new Map();
      for (const old of e.target.result) {
        if (old.schemaVersion !== 1) continue;
        const { source, questions, test, imageIds } = migrateV1Test(old);
        tx.objectStore('sources').put(source);
        for (const q of questions) tx.objectStore('questions').put(q);
        tests.put(test);
        for (const [from, to] of imageIds) renamed.set(from, { to, sourceId: source.id });
      }
      images.openCursor().onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) return;
        const im = cur.value;
        const r = renamed.get(im.id);
        if (r) {
          images.put({ id: r.to, sourceId: r.sourceId, blob: im.blob, width: im.width, height: im.height });
          cur.delete();
        }
        cur.continue();
      };
    };
  }
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, req.transaction, e.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The app is open in another tab with an older version. Close the other tabs and reload.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The save was cancelled by the browser.'));
  });
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function getOne(store, key) {
  const db = await openDb();
  return request(db.transaction(store).objectStore(store).get(key));
}

async function getAll(store, index = null, key = undefined) {
  const db = await openDb();
  const s = db.transaction(store).objectStore(store);
  return request((index ? s.index(index) : s).getAll(key === undefined ? undefined : IDBKeyRange.only(key)));
}

export const getTest = (id) => getOne('tests', id);
export const getSource = (id) => getOne('sources', id);
export const getImage = (id) => getOne('images', id);

export async function listTests() {
  return (await getAll('tests')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export const listSources = () => getAll('sources');
export const listQuestions = () => getAll('questions');

/** Questions in the given order (missing ones are left out). */
export async function getQuestions(ids) {
  const db = await openDb();
  const store = db.transaction('questions').objectStore('questions');
  const rows = await Promise.all(ids.map((id) => request(store.get(id))));
  return rows.filter(Boolean);
}

/** All pictures of the given sources, as a Map(id -> record). */
export async function getImagesForSources(sourceIds) {
  const map = new Map();
  for (const sid of sourceIds) for (const im of await getAll('images', 'sourceId', sid)) map.set(im.id, im);
  return map;
}

/** Save an imported PDF (source, its questions and pictures, and its test) in ONE transaction. */
export async function saveImport({ source, questions, test, images }) {
  const db = await openDb();
  const tx = db.transaction(['sources', 'questions', 'images', 'tests'], 'readwrite');
  const existing = await request(tx.objectStore('sources').get(source.id));
  if (existing) {
    tx.abort();
    throw new Error(`This PDF is already in your library as "${existing.name}".`);
  }
  tx.objectStore('sources').add(source);
  for (const q of questions) tx.objectStore('questions').add(q);
  for (const im of images) tx.objectStore('images').add(im);
  tx.objectStore('tests').add(test);
  await done(tx);
}

/**
 * What deleting a test would remove: its attempts, and — for a test made from one PDF — that PDF's
 * questions and pictures unless another test still uses them.
 */
export async function deletionPlan(testId) {
  const test = await getTest(testId);
  if (!test) return null;
  const attempts = await getAll('attempts', 'testId', testId);
  const others = (await listTests()).filter((t) => t.id !== testId);
  const usedElsewhere = new Set(others.flatMap(testQuestionIds));
  const sources = [];
  if (test.kind === 'pdf' || test.kind === 'mock') {
    for (const sid of test.sourceIds) {
      const src = await getSource(sid);
      if (src && !src.questionIds.some((id) => usedElsewhere.has(id))) sources.push(src);
    }
  }
  return { test, attempts, sources };
}

/** Delete a test as described by deletionPlan() (only ever called after the user confirmed). */
export async function deleteTest(testId) {
  const plan = await deletionPlan(testId);
  if (!plan) return;
  const db = await openDb();
  const tx = db.transaction(['tests', 'attempts', 'questionAttempts', 'sources', 'questions', 'images', 'settings'], 'readwrite');
  tx.objectStore('tests').delete(testId);
  for (const a of plan.attempts) {
    tx.objectStore('attempts').delete(a.id);
    const keys = await request(tx.objectStore('questionAttempts').index('attemptId').getAllKeys(IDBKeyRange.only(a.id)));
    for (const k of keys) tx.objectStore('questionAttempts').delete(k);
  }
  for (const src of plan.sources) {
    tx.objectStore('sources').delete(src.id);
    for (const qid of src.questionIds) tx.objectStore('questions').delete(qid);
    const keys = await request(tx.objectStore('images').index('sourceId').getAllKeys(IDBKeyRange.only(src.id)));
    for (const k of keys) tx.objectStore('images').delete(k);
  }
  // a note for the user's other devices (sync): they ask before removing their copy
  const notes = (await request(tx.objectStore('settings').get('sync.deletions')))?.value || [];
  const note = { kind: 'test', id: testId, name: plan.test.name, at: Date.now(), sourceIds: plan.sources.map((x) => x.id), attemptIds: plan.attempts.map((a) => a.id) };
  tx.objectStore('settings').put({ key: 'sync.deletions', value: [...notes.filter((n) => !(n.kind === 'test' && n.id === testId)), note], at: note.at });
  await done(tx);
}

/** The unfinished attempt of a test, if any (there is at most one). */
export async function getInProgressAttempt(testId) {
  return (await getAll('attempts', 'testId', testId)).find((a) => a.status === 'in-progress') || null;
}

export const getAttempt = (id) => getOne('attempts', id);

/** Autosave of the live attempt. */
export async function putAttempt(attempt) {
  const db = await openDb();
  const tx = db.transaction('attempts', 'readwrite');
  tx.objectStore('attempts').put({ ...attempt, updatedAt: Date.now() });
  await done(tx);
}

/** Submit: the attempt and its per-question records are written together (all or nothing). */
export async function saveSubmittedAttempt(attempt, records) {
  const db = await openDb();
  const tx = db.transaction(['attempts', 'questionAttempts'], 'readwrite');
  tx.objectStore('attempts').put({ ...attempt, updatedAt: Date.now() });
  for (const r of records) tx.objectStore('questionAttempts').put(r);
  await done(tx);
}

/** Discard an unfinished attempt (only after the user confirmed "start again"). */
export async function discardAttempt(id) {
  const db = await openDb();
  const tx = db.transaction('attempts', 'readwrite');
  tx.objectStore('attempts').delete(id);
  await done(tx);
}

export const listAttempts = (testId) => getAll('attempts', 'testId', testId);

export const getQuestionAttempts = (attemptId) => getAll('questionAttempts', 'attemptId', attemptId);
export const listAllAttempts = () => getAll('attempts');
export const listAllQuestionAttempts = () => getAll('questionAttempts');

/**
 * Data saved before topics / sub-topics existed gets them from the file name and the PDF heading
 * (topics.js). Runs at start-up; only touches records without an `area` field.
 */
export async function fillMissingTopics() {
  const sources = await getAll('sources');
  const todo = sources.filter((s) => !('area' in s));
  if (!todo.length) return 0;
  const db = await openDb();
  const tx = db.transaction(['sources', 'questions'], 'readwrite');
  for (const s of todo) {
    const { area, chapter } = classifyTopic(s.subject, s.fileName, s.topic);
    tx.objectStore('sources').put({ ...s, area, chapter });
    for (const qid of s.questionIds) {
      const q = await request(tx.objectStore('questions').get(qid));
      if (q && !('area' in q)) tx.objectStore('questions').put({ ...q, area, chapter });
    }
  }
  await done(tx);
  return todo.length;
}

/** Set the topic and sub-topic of one PDF and all its questions (the user's choice). */
export async function setSourceTopic(sourceId, area, chapter) {
  const db = await openDb();
  const tx = db.transaction(['sources', 'questions'], 'readwrite');
  const s = await request(tx.objectStore('sources').get(sourceId));
  if (!s) throw new Error('This PDF is no longer in the library.');
  const now = Date.now();
  tx.objectStore('sources').put(stamp({ ...s, area, chapter }, ['area', 'chapter'], now));
  for (const qid of s.questionIds) {
    const q = await request(tx.objectStore('questions').get(qid));
    if (q) tx.objectStore('questions').put(stamp({ ...q, area, chapter }, ['area', 'chapter'], now));
  }
  await done(tx);
}

/** Save a custom sectional test (only references to existing questions; no pictures copied). */
export async function saveCustomTest(test) {
  const db = await openDb();
  const tx = db.transaction('tests', 'readwrite');
  tx.objectStore('tests').add(test);
  await done(tx);
}

/** Change fields of one per-question attempt record (e.g. mistake reason, re-attempts). */
export async function updateQuestionAttempt(id, patch) {
  const db = await openDb();
  const tx = db.transaction('questionAttempts', 'readwrite');
  const store = tx.objectStore('questionAttempts');
  const rec = await request(store.get(id));
  if (!rec) throw new Error('Record not found.');
  store.put({ ...rec, ...patch });
  await done(tx);
}

/** Set the user's own sub-topic tag on a question (used everywhere the question appears). */
/**
 * Topic and sub-topic of ONE question (used to tag mock questions; a DPP's questions follow their
 * PDF through setSourceTopic). area 'Mock' + chapter 'Not tagged' = untagged again.
 */
export async function updateQuestionTopic(questionId, area, chapter) {
  const db = await openDb();
  const tx = db.transaction('questions', 'readwrite');
  const store = tx.objectStore('questions');
  const q = await request(store.get(questionId));
  if (!q) throw new Error('Question not found.');
  store.put(stamp({ ...q, area: String(area || '').slice(0, 40), chapter: String(chapter || '').trim().slice(0, 80) }, ['area', 'chapter']));
  await done(tx);
}

export async function updateQuestionSubTopic(questionId, subTopic) {
  const db = await openDb();
  const tx = db.transaction('questions', 'readwrite');
  const store = tx.objectStore('questions');
  const q = await request(store.get(questionId));
  if (!q) throw new Error('Question not found.');
  store.put(stamp({ ...q, subTopic: String(subTopic || '').trim().slice(0, 80) }, ['subTopic']));
  await done(tx);
}

/** Change a test's time limit (minutes). */
export async function setTestTimeLimit(testId, minutes) {
  const db = await openDb();
  const tx = db.transaction('tests', 'readwrite');
  const store = tx.objectStore('tests');
  const t = await request(store.get(testId));
  if (!t) throw new Error('Test not found.');
  t.settings = { ...t.settings, timeLimitMin: minutes };
  store.put(stamp(t, ['settings']));
  await done(tx);
}

/** Save a made-up demo test (used to try the passage layout before VARC/LRDI PDFs can be added). */
export async function saveDemo({ source, questions, test, images }) {
  const db = await openDb();
  const tx = db.transaction(['sources', 'questions', 'images', 'tests'], 'readwrite');
  tx.objectStore('sources').put(source);
  for (const q of questions) tx.objectStore('questions').put(q);
  for (const im of images) tx.objectStore('images').put(im);
  tx.objectStore('tests').put(test);
  await done(tx);
}

/** Everything in the database (for the backup file). Images keep their Blobs. */
export async function exportAll() {
  const out = {};
  for (const s of ['sources', 'questions', 'tests', 'attempts', 'questionAttempts', 'settings', 'images']) out[s] = await getAll(s);
  return out;
}

/** Ids already on this device, per store (to plan a restore without loading every picture). */
export async function existingForMerge() {
  const db = await openDb();
  const out = {};
  for (const s of ['sources', 'questions', 'tests', 'attempts', 'questionAttempts', 'settings']) out[s] = await getAll(s);
  out.images = (await request(db.transaction('images').objectStore('images').getAllKeys())).map((id) => ({ id }));
  return out;
}

/** Everything the sync engine compares (no pictures: those are loaded per PDF when needed). */
export async function syncSnapshot() {
  const out = {};
  for (const s of ['sources', 'questions', 'tests', 'attempts', 'questionAttempts', 'settings']) out[s] = await getAll(s);
  return out;
}

/** Pictures of one PDF (for uploading its picture pack). */
export const imagesOfSource = (sourceId) => getAll('images', 'sourceId', sourceId);

/** Write a restore plan (backup.js planMerge) in one transaction: all or nothing. Never deletes. */
export async function applyRestore(put, images) {
  const db = await openDb();
  const stores = ['sources', 'questions', 'tests', 'attempts', 'questionAttempts', 'settings', 'images'];
  const tx = db.transaction(stores, 'readwrite');
  for (const [store, list] of Object.entries(put)) for (const r of list) tx.objectStore(store).put(r);
  for (const im of images) tx.objectStore('images').put(im);
  await done(tx);
}

export async function getSetting(key, fallback = null) {
  const row = await getOne('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await openDb();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value, at: Date.now() });
  await done(tx);
}

/** Ask the browser to protect this app's storage from automatic clean-up. Returns true/false/null. */
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageStatus() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
  } catch {
    // leave unknown
  }
  return out;
}
