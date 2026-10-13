// Stage 8: who is signed in on this device, the Google permission ("access token"), and running a
// sync. Signing in only ADDS sync: the app keeps working fully without it (offline-first).
//
// - Google's sign-in code (Google Identity Services) is loaded from Google only when the user
//   presses "Sign in with Google". The permission it gives lasts about an hour; after that the next
//   press of "Sync now" asks Google again (usually no typing: Google remembers the choice).
// - Each account has its own database on this device (db.js useDatabase); the active account is
//   remembered in this browser (localStorage key "cpl.account": a random-looking key, the email and
//   the name — no password and no permission token).
// - The automated tests use a pretend Google on the local test server (localhost only).
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, GIS_SCRIPT } from './config.js';
import { createGoogleDrive, AuthError } from './drive.js';
import { syncOnce } from './engine.js';
import {
  useDatabase, syncSnapshot, imagesOfSource, applyRestore, getSetting, setSetting, exportAll, deleteDatabase, databaseNameFor,
} from '../db.js';

const ACCOUNT_KEY = 'cpl.account';
const TOKEN_KEY = 'cpl.token'; // kept for this browser session only (sessionStorage), never in a backup

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
/** Automated tests: "cpl.fakeGoogle" names a pretend user on the local test server. */
const fakeUser = () => { try { return isLocalHost() ? localStorage.getItem('cpl.fakeGoogle') : null; } catch { return null; } };
const apiBase = () => (fakeUser() ? `${location.origin}/__google` : 'https://www.googleapis.com');

export function activeAccount() {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null'); } catch { return null; }
}
function setActiveAccount(a) {
  try { if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)); else localStorage.removeItem(ACCOUNT_KEY); } catch { /* private window */ }
}

/** At start-up: open the signed-in account's database (or the device's own). */
export async function openActiveDatabase() {
  const a = activeAccount();
  await useDatabase(a ? a.key : null);
  return a;
}

// ---------- the permission (access token) ----------
let memoryToken = null;
function savedToken() {
  if (memoryToken) return memoryToken;
  try { memoryToken = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { memoryToken = null; }
  return memoryToken;
}
function saveToken(t) {
  memoryToken = t;
  try { if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private window */ }
}
export function hasValidToken() {
  const t = savedToken();
  return !!(t && t.token && t.exp > Date.now() + 60_000);
}

let gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SCRIPT; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('Google sign-in could not be loaded. Check the internet connection and try again.')); };
      document.head.append(s);
    });
  }
  return gisLoading;
}

/**
 * Ask Google for the permission. Must be called from a button press (browsers block pop-ups
 * otherwise). hint = the email of the account already in use (skips the account chooser).
 */
async function requestToken({ hint = null, firstTime = false } = {}) {
  const user = fakeUser();
  if (user) { const t = { token: `test-token:${user}`, exp: Date.now() + 3600_000 }; saveToken(t); return t; }
  if (!GOOGLE_CLIENT_ID) throw new Error('Sign-in is not set up in this copy of the app.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      hint: hint || undefined,
      callback: (r) => {
        if (r.error) { reject(new Error(r.error === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in did not work (${r.error}).`)); return; }
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, 'https://www.googleapis.com/auth/drive.appdata')) {
          reject(new Error('Sync needs permission to use the app\'s own hidden folder in your Drive. Please sign in again and allow it (the app cannot see any of your other files).'));
          return;
        }
        const t = { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        saveToken(t);
        resolve(t);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'The Google window was closed before signing in finished.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.' : 'Google sign-in did not work.')),
    });
    client.requestAccessToken({ prompt: firstTime ? 'select_account' : '' });
  });
}

const getToken = async () => {
  if (!hasValidToken()) throw new AuthError('Your Google sign-in has expired. Press "Sync now" to continue.');
  return savedToken().token;
};
export const drive = () => createGoogleDrive({ getToken, base: apiBase() });

async function accountKeyOf(sub) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cat-practice-lab:${sub}`));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign in (button press). Returns { account, deviceCounts } — deviceCounts tells the page whether
 * this device has its own data that could be brought into the account (asked once per account).
 */
export async function signIn() {
  const t = await requestToken({ firstTime: true });
  const res = await fetch(`${fakeUser() ? apiBase() : 'https://www.googleapis.com'}/oauth2/v3/userinfo`, { headers: { Authorization: `Bearer ${t.token}` } }).catch(() => null);
  if (!res || !res.ok) throw new Error('Signed in, but Google did not say which account it is. Try again.');
  const info = await res.json();
  const account = { key: await accountKeyOf(info.sub), email: info.email || '', name: info.name || '', since: Date.now() };
  // what does this device have without sign-in?
  await useDatabase(null);
  const device = await syncSnapshot();
  const deviceCounts = { tests: device.tests.length, attempts: device.attempts.filter((a) => a.status === 'submitted').length };
  setActiveAccount(account);
  await useDatabase(account.key);
  const asked = await getSetting('sync.deviceDataAsked', false);
  return { account, deviceCounts: asked ? null : deviceCounts };
}

/** Copy everything of this device (without sign-in) into the signed-in account's database. Never deletes. */
export async function bringDeviceDataIn(account) {
  await useDatabase(null);
  const all = await exportAll();
  await useDatabase(account.key);
  const put = {
    sources: all.sources, questions: all.questions, tests: all.tests, attempts: all.attempts,
    questionAttempts: all.questionAttempts, settings: all.settings.filter((s) => !String(s.key).startsWith('sync.') && s.key !== 'lastBackupAt' && s.key !== 'lastBackupInfo'),
  };
  await applyRestore(put, all.images);
  await setSetting('sync.deviceDataAsked', true);
  return { tests: all.tests.length, attempts: all.attempts.filter((a) => a.status === 'submitted').length };
}

export async function skipDeviceData() { await setSetting('sync.deviceDataAsked', true); }

/**
 * Sign out. keepCopy = true: this account's data stays on this device (seen again at the next
 * sign-in, and synced then); false: it is removed from this device (it stays in the user's Drive).
 */
export async function signOut({ keepCopy }) {
  const a = activeAccount();
  const t = savedToken();
  saveToken(null);
  if (t && window.google?.accounts?.oauth2?.revoke && !fakeUser()) { try { window.google.accounts.oauth2.revoke(t.token, () => {}); } catch { /* best effort */ } }
  setActiveAccount(null);
  await useDatabase(null);
  if (a && !keepCopy) await deleteDatabase(a.key);
}

let running = null;
/**
 * Sync now. interactive = true when called from a button press: an expired permission is renewed
 * first (Google may show its window). Results and errors are also saved for the Account page.
 */
export async function syncNow({ interactive = false, onProgress = () => {} } = {}) {
  const a = activeAccount();
  if (!a) throw new Error('Not signed in.');
  if (running) return running;
  running = (async () => {
    try {
      if (!hasValidToken()) {
        if (!interactive) throw new AuthError('Your Google sign-in has expired. Press "Sync now" to continue.');
        await requestToken({ hint: a.email });
      }
      const store = { snapshot: syncSnapshot, imagesOfSource, apply: applyRestore, getSetting, setSetting };
      const run = () => syncOnce({ drive: drive(), store, onProgress });
      const result = navigator.locks ? await navigator.locks.request(`cpl-sync-${a.key}`, run) : await run();
      await setSetting('sync.lastError', null);
      return result;
    } catch (e) {
      await setSetting('sync.lastError', { at: Date.now(), message: e.message, auth: e instanceof AuthError });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** After a test is submitted or a PDF saved: sync quietly if the permission is still valid. */
export function syncSoon() {
  if (!activeAccount() || !hasValidToken() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  setTimeout(() => { syncNow().catch(() => { /* shown on the Account page */ }); }, 1500);
}

/** Storage numbers for the Account page: { appBytes, driveUsage, driveLimit } (null if unknown). */
export async function storageUse() {
  const d = drive();
  const [list, about] = await Promise.all([d.list(), d.about()]);
  return { appBytes: list.reduce((s, f) => s + f.size, 0), files: list.length, driveUsage: about.usage, driveLimit: about.limit };
}

export { AuthError, databaseNameFor };
