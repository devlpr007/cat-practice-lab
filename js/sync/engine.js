// Stage 8: one sync run between this device and the user's own Drive app-data folder.
// Works through two small interfaces so it can be tested without Google or IndexedDB:
//   drive: list() -> [{ id, name, version, size }], download(id) -> Blob,
//          create(name, blob) -> { id, version }, update(id, blob) -> { id, version },
//          remove(id), about() -> { limit, usage } | null
//   store: snapshot() -> { sources, questions, tests, attempts, questionAttempts, settings },
//          imagesOfSource(sourceId) -> [{ id, sourceId, blob, width, height }],
//          apply(put: { store: [records] }, images: [records]), getSetting(key, fallback), setSetting(key, value)
//
// Files in Drive (all inside the hidden app-data folder, which only this app can see):
//   tests.json, settings.json, deletions.json, src-<pdf id>.json (a PDF's details and questions),
//   img-<pdf id>.bin (its pictures, never change), att-<attempt id>.json (a submitted attempt).
// Nothing local is ever deleted by a sync; a failed sync leaves this device's data as it was
// (writes happen only after everything needed was downloaded and merged).
import {
  mergeAttemptBundle, mergeSourceBundle, mergeTests, mergeSettings, mergeTombstones, isOpenDeletion, isDeviceSetting, addReplaced,
} from './merge.js';

export const SYNC_FORMAT = 'cat-practice-lab-sync';
export const SYNC_VERSION = 1;
const STATE = 'sync.files';
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function hashText(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** JSON with object keys in a fixed order, so the same data always gives the same text (and hash). */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canon(x))).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const stable = canon;

/** Pictures of one PDF as one file: "CPLIMG01", header length, header (JSON), then the picture bytes. */
export async function packImages(images) {
  const header = images.map((im) => ({ id: im.id, sourceId: im.sourceId, width: im.width, height: im.height, type: im.blob.type || 'image/png', size: im.blob.size }));
  const h = enc.encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, h.length, true);
  return new Blob([enc.encode('CPLIMG01'), len, h, ...images.map((im) => im.blob)], { type: 'application/octet-stream' });
}

export async function unpackImages(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (dec.decode(buf.subarray(0, 8)) !== 'CPLIMG01') throw new Error('A picture file in your Drive is damaged.');
  const n = new DataView(buf.buffer, buf.byteOffset + 8, 4).getUint32(0, true);
  const header = JSON.parse(dec.decode(buf.subarray(12, 12 + n)));
  let off = 12 + n;
  return header.map((x) => {
    const blob = new Blob([buf.slice(off, off + x.size)], { type: x.type });
    off += x.size;
    return { id: x.id, sourceId: x.sourceId, width: x.width, height: x.height, blob };
  });
}

/**
 * One sync. Returns { downloaded, uploaded, removed, bytesUp, bytesDown, replaced, openDeletions }.
 * Throws a plain-language Error when something goes wrong; this device's data is then unchanged.
 */
export async function syncOnce({ drive, store, now = Date.now(), onProgress = () => {} }) {
  const out = { downloaded: 0, uploaded: 0, removed: 0, bytesUp: 0, bytesDown: 0, replaced: 0, openDeletions: [] };
  onProgress('Looking at your Drive');
  const remoteList = await drive.list();
  const remote = new Map();
  for (const f of remoteList) { if (!remote.has(f.name)) remote.set(f.name, []); remote.get(f.name).push(f); }
  const state = { ...(await store.getSetting(STATE, {})) };
  const changedRemote = (name) => (remote.get(name) || []).some((f) => !state[name] || state[name].id !== f.id || state[name].version !== f.version) || (remote.get(name) || []).length > 1;
  const readJson = async (f) => {
    const b = await drive.download(f.id); out.bytesDown += b.size; out.downloaded++;
    const text = await b.text();
    state[f.name] = { id: f.id, version: f.version, hash: await hashText(text) };
    return JSON.parse(text);
  };
  const readAll = async (name) => { const list = []; for (const f of remote.get(name) || []) list.push(await readJson(f)); return list; };

  // ---- this device ----
  const local = await store.snapshot();
  const settingRow = (key) => local.settings.find((r) => r.key === key);
  const qById = new Map(local.questions.map((q) => [q.id, q]));
  const localSources = new Map(local.sources.map((s) => [s.id, { source: s, questions: s.questionIds.map((id) => qById.get(id)).filter(Boolean) }]));
  const recsByAttempt = new Map();
  for (const r of local.questionAttempts) { if (!recsByAttempt.has(r.attemptId)) recsByAttempt.set(r.attemptId, []); recsByAttempt.get(r.attemptId).push(r); }
  const localAttempts = new Map(local.attempts.filter((a) => a.status === 'submitted').map((a) => [a.id, { attempt: a, records: recsByAttempt.get(a.id) || [] }]));
  const hadTest = new Set(local.tests.map((t) => t.id));

  // ---- deletions first: what this device removed must not come back ----
  let deletions = settingRow('sync.deletions')?.value || [];
  for (const d of (changedRemote('deletions.json') ? await readAll('deletions.json') : [])) deletions = mergeTombstones(deletions, d.deletions || []);
  const removedHere = deletions.filter((d) => isOpenDeletion(d) && !hadTest.has(d.id));
  const skipTests = new Set(removedHere.map((d) => d.id));
  const skipSources = new Set(removedHere.flatMap((d) => d.sourceIds || []));
  const skipAttempts = new Set(removedHere.flatMap((d) => d.attemptIds || []));

  // ---- download and merge what changed in Drive ----
  let replaced = [];
  let tests = local.tests;
  if (changedRemote('tests.json')) {
    onProgress('Reading your tests');
    for (const d of await readAll('tests.json')) {
      const m = mergeTests(tests, (d.tests || []).filter((t) => !skipTests.has(t.id)));
      tests = m.tests; replaced.push(...m.replaced);
    }
  }
  let settings = local.settings.filter((r) => !isDeviceSetting(r.key));
  if (changedRemote('settings.json')) {
    for (const d of await readAll('settings.json')) {
      const m = mergeSettings(settings, d.settings || []);
      settings = m.settings; replaced.push(...m.replaced);
    }
  }
  const sources = new Map(localSources);
  const attempts = new Map(localAttempts);
  const newImages = [];
  const names = [...remote.keys()];
  const srcNames = names.filter((n) => /^src-.+\.json$/.test(n) && changedRemote(n));
  const attNames = names.filter((n) => /^att-.+\.json$/.test(n) && changedRemote(n));
  let k = 0;
  for (const name of srcNames) {
    onProgress(`Reading your PDFs (${++k} of ${srcNames.length})`);
    const id = name.slice(4, -5);
    if (skipSources.has(id)) continue;
    for (const d of await readAll(name)) {
      const m = mergeSourceBundle(sources.get(id), { source: d.source, questions: d.questions });
      sources.set(id, m.bundle); replaced.push(...m.replaced);
    }
    if (!localSources.has(id)) {
      const img = (remote.get(`img-${id}.bin`) || [])[0];
      if (!img) throw new Error('A PDF in your Drive has no pictures yet (another device may still be uploading it). Try again in a minute.');
      const b = await drive.download(img.id); out.bytesDown += b.size; out.downloaded++;
      newImages.push(...await unpackImages(b));
      state[`img-${id}.bin`] = { id: img.id, version: img.version, hash: 'pictures' };
    }
  }
  k = 0;
  for (const name of attNames) {
    onProgress(`Reading your attempts (${++k} of ${attNames.length})`);
    const id = name.slice(4, -5);
    if (skipAttempts.has(id)) continue;
    for (const d of await readAll(name)) {
      if (d.attempt?.status !== 'submitted') continue;
      const m = mergeAttemptBundle(attempts.get(id), { attempt: d.attempt, records: d.records || [] });
      attempts.set(id, m.bundle); replaced.push(...m.replaced);
    }
  }

  // ---- write what changed to this device (one transaction, nothing deleted) ----
  const put = { sources: [], questions: [], tests: [], attempts: [], questionAttempts: [], settings: [] };
  const was = (list) => new Map(list.map((r) => [r.id ?? r.key, stable(r)]));
  const before = { sources: was(local.sources), questions: was(local.questions), tests: was(local.tests), attempts: was(local.attempts), questionAttempts: was(local.questionAttempts), settings: was(local.settings) };
  const add = (s, r) => { if (before[s].get(r.id ?? r.key) !== stable(r)) put[s].push(r); };
  for (const b of sources.values()) { add('sources', b.source); for (const q of b.questions) add('questions', q); }
  for (const t of tests) add('tests', t);
  for (const b of attempts.values()) { add('attempts', b.attempt); for (const r of b.records) add('questionAttempts', r); }
  for (const r of settings) add('settings', r);
  const changedLocally = Object.values(put).some((l) => l.length) || newImages.length;
  if (changedLocally) { onProgress('Saving on this device'); await store.apply(put, newImages); }

  // ---- upload what Drive does not have yet ----
  const files = [];
  files.push({ name: 'tests.json', body: { format: SYNC_FORMAT, version: SYNC_VERSION, tests } });
  files.push({ name: 'settings.json', body: { format: SYNC_FORMAT, version: SYNC_VERSION, settings } });
  files.push({ name: 'deletions.json', body: { format: SYNC_FORMAT, version: SYNC_VERSION, deletions } });
  for (const [id, b] of sources) files.push({ name: `src-${id}.json`, body: { format: SYNC_FORMAT, version: SYNC_VERSION, source: b.source, questions: b.questions } });
  for (const [id, b] of attempts) files.push({ name: `att-${id}.json`, body: { format: SYNC_FORMAT, version: SYNC_VERSION, attempt: b.attempt, records: b.records } });
  const uploads = [];
  for (const f of files) {
    const text = canon(f.body);
    const hash = await hashText(text);
    const there = remote.get(f.name) || [];
    const st = state[f.name];
    if (there.length === 1 && st && st.hash === hash && st.id === there[0].id && st.version === there[0].version) continue;
    uploads.push({ name: f.name, blob: new Blob([text], { type: 'application/json' }), hash, there });
  }
  for (const id of sources.keys()) {
    const name = `img-${id}.bin`;
    if ((remote.get(name) || []).length) continue;
    uploads.push({ name, images: id, hash: 'pictures', there: [] });
  }
  // room in Drive: estimate before writing anything big
  const about = await drive.about().catch(() => null);
  if (about && about.limit) {
    let need = 0;
    for (const u of uploads) need += u.blob ? u.blob.size : (await store.imagesOfSource(u.images)).reduce((s, im) => s + im.blob.size, 0);
    if (about.usage + need > about.limit) {
      throw new Error(`Your Google Drive is full: syncing needs about ${Math.ceil(need / 1e6)} MB more. Free some space in Drive (or your Google account) and try again. Your data on this device is safe.`);
    }
  }
  k = 0;
  for (const u of uploads) {
    onProgress(`Uploading (${++k} of ${uploads.length})`);
    const blob = u.blob || await packImages(await store.imagesOfSource(u.images));
    const res = u.there.length ? await drive.update(u.there[0].id, blob) : await drive.create(u.name, blob);
    out.uploaded++; out.bytesUp += blob.size;
    state[u.name] = { id: res.id, version: res.version, hash: u.hash };
    // two devices created the same file at the same moment: their copies were merged above, keep one
    for (const extra of u.there.slice(1)) { await drive.remove(extra.id); out.removed++; }
  }
  // files of tests this device removed (and the user has not kept elsewhere): free the space
  for (const d of removedHere) {
    for (const name of [...(d.attemptIds || []).map((x) => `att-${x}.json`), ...(d.sourceIds || []).flatMap((x) => [`src-${x}.json`, `img-${x}.bin`])]) {
      for (const f of remote.get(name) || []) { await drive.remove(f.id); out.removed++; }
      delete state[name];
    }
  }
  // remember every file as it is now in Drive (also those that did not change)
  for (const [name, list] of remote) if (!state[name] && list.length === 1 && !name.startsWith('img-')) state[name] = { id: list[0].id, version: list[0].version, hash: null };

  const log = addReplaced(settingRow('sync.replaced')?.value || [], replaced, now);
  out.replaced = replaced.length;
  out.openDeletions = deletions.filter((d) => isOpenDeletion(d) && hadTest.has(d.id));
  await store.setSetting('sync.deletions', deletions);
  await store.setSetting('sync.replaced', log);
  await store.setSetting(STATE, state);
  await store.setSetting('sync.lastSyncedAt', now);
  onProgress('Done');
  return out;
}
