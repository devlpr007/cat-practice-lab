// Stage 8: talking to the signed-in user's OWN Google Drive, only its hidden app-data folder
// (permission "drive.appdata": the app cannot see any other Drive file, and other apps cannot see
// these). Plain fetch() calls to Google's documented web addresses; no other code is loaded.
// The automated tests point `base` at the local pretend Google (tools/fake-google.mjs).

const SIMPLE_LIMIT = 4.5 * 1024 * 1024; // larger files use Google's "resumable" upload

export class AuthError extends Error {}

/**
 * getToken(): the current access token (a promise). Errors are thrown as plain-language messages;
 * AuthError means "sign in again" (the permission ran out, usually after an hour).
 */
export function createGoogleDrive({ getToken, base = 'https://www.googleapis.com' }) {
  async function call(method, path, { body = null, headers = {}, expect = 'json', retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(path.startsWith('http') ? path : base + path, { method, body, headers: { Authorization: `Bearer ${await getToken()}`, ...headers } });
      } catch {
        throw new Error('No internet connection (or Google could not be reached). Your data on this device is safe; try again later.');
      }
      if (res.ok) {
        if (expect === 'json') return res.status === 204 ? null : res.json();
        if (expect === 'blob') return res.blob();
        return res;
      }
      let info = null;
      try { info = await res.json(); } catch { /* not JSON */ }
      const reason = info?.error?.errors?.[0]?.reason || '';
      if (res.status === 401) throw new AuthError('Your Google sign-in has expired. Press "Sync now" (or sign in) again.');
      if (reason === 'storageQuotaExceeded') throw new Error('Your Google Drive is full. Free some space in Drive (or your Google account) and try again. Your data on this device is safe.');
      if ((res.status === 429 || res.status >= 500 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
        continue;
      }
      throw new Error(`Google Drive answered with an error (${res.status}${info?.error?.message ? `: ${info.error.message}` : ''}). Your data on this device is safe; try again later.`);
    }
  }

  async function upload(method, path, name, blob) {
    const type = blob.type || 'application/octet-stream';
    if (blob.size > SIMPLE_LIMIT) {
      const start = await call(method, `${path}${path.includes('?') ? '&' : '?'}uploadType=resumable`, {
        body: method === 'POST' ? JSON.stringify({ name, parents: ['appDataFolder'] }) : null,
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
        expect: 'response',
      });
      const location = start.headers.get('Location');
      if (!location) throw new Error('Google Drive did not accept the upload. Try again later.');
      const done = await call('PUT', location, { body: blob, headers: { 'Content-Type': type } });
      return { id: done.id, version: Number(done.version) };
    }
    if (method === 'POST') {
      const boundary = `cpl${Math.random().toString(16).slice(2)}`;
      const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
      const r = await call('POST', `${path}?uploadType=multipart&fields=id,version`, { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
      return { id: r.id, version: Number(r.version) };
    }
    const r = await call('PATCH', `${path}?uploadType=media&fields=id,version`, { body: blob, headers: { 'Content-Type': type } });
    return { id: r.id, version: Number(r.version) };
  }

  return {
    async list() {
      const out = [];
      let page = '';
      do {
        const r = await call('GET', `/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,version,size)${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
        for (const f of r.files || []) out.push({ id: f.id, name: f.name, version: Number(f.version), size: Number(f.size || 0) });
        page = r.nextPageToken || '';
      } while (page);
      return out;
    },
    download: (id) => call('GET', `/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { expect: 'blob' }),
    create: (name, blob) => upload('POST', '/upload/drive/v3/files', name, blob),
    update: (id, blob) => upload('PATCH', `/upload/drive/v3/files/${encodeURIComponent(id)}`, null, blob),
    remove: (id) => call('DELETE', `/drive/v3/files/${encodeURIComponent(id)}`),
    async about() {
      const r = await call('GET', '/drive/v3/about?fields=storageQuota(limit,usage),user(emailAddress,displayName)');
      return { limit: r.storageQuota?.limit ? Number(r.storageQuota.limit) : null, usage: Number(r.storageQuota?.usage || 0) };
    },
    /** Bytes used by this app's own files in Drive. */
    async appUsage() { return (await this.list()).reduce((s, f) => s + f.size, 0); },
  };
}
