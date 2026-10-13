// A pretend Google Drive app-data folder kept in memory (tests only; also used by the local test
// server's fake Drive). Same interface as the real Drive client in drive.js.
export function createMemoryDrive({ limit = null } = {}) {
  const files = new Map(); // id -> { id, name, version, blob }
  let next = 1;
  const drive = {
    offline: false,
    calls: 0,
    files,
    check() { drive.calls++; if (drive.offline) throw new Error('No internet connection.'); },
    async list() { drive.check(); return [...files.values()].map((f) => ({ id: f.id, name: f.name, version: f.version, size: f.blob.size })); },
    async download(id) { drive.check(); const f = files.get(id); if (!f) throw new Error('File not found in Drive.'); return f.blob; },
    async create(name, blob) { drive.check(); const f = { id: `f${next++}`, name, version: 1, blob }; files.set(f.id, f); return { id: f.id, version: f.version }; },
    async update(id, blob) { drive.check(); const f = files.get(id); if (!f) throw new Error('File not found in Drive.'); f.blob = blob; f.version++; return { id, version: f.version }; },
    async remove(id) { drive.check(); files.delete(id); },
    async about() { drive.check(); return { limit, usage: [...files.values()].reduce((s, f) => s + f.blob.size, 0) }; },
  };
  return drive;
}

/** A device's data kept in memory, with the same interface the sync engine uses for IndexedDB. */
export function createMemoryStore(init = {}) {
  const data = { sources: [], questions: [], tests: [], attempts: [], questionAttempts: [], settings: [], images: [], ...structuredClone(init) };
  const key = (s, r) => (s === 'settings' ? r.key : r.id);
  return {
    data,
    async snapshot() { return structuredClone(Object.fromEntries(['sources', 'questions', 'tests', 'attempts', 'questionAttempts', 'settings'].map((s) => [s, data[s]]))); },
    async imagesOfSource(id) { return data.images.filter((im) => im.sourceId === id); },
    async apply(put, images) {
      for (const [s, list] of Object.entries(put)) {
        for (const r of list) { const i = data[s].findIndex((x) => key(s, x) === key(s, r)); if (i >= 0) data[s][i] = structuredClone(r); else data[s].push(structuredClone(r)); }
      }
      for (const im of images) if (!data.images.some((x) => x.id === im.id)) data.images.push(im);
    },
    async getSetting(k, fallback = null) { const r = data.settings.find((x) => x.key === k); return r ? structuredClone(r.value) : fallback; },
    async setSetting(k, value) { const i = data.settings.findIndex((x) => x.key === k); const r = { key: k, value: structuredClone(value), at: Date.now() }; if (i >= 0) data.settings[i] = r; else data.settings.push(r); },
  };
}
