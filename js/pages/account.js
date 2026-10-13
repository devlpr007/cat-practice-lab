// Stage 8: #/account — sign in with Google (optional), sync status, "Sync now", storage use,
// deletions from other devices, changes replaced by other devices, sign out. The app works fully
// without signing in; signing in only adds sync through the user's OWN Google Drive.
import { h, fill, formatDate, formatBytes, confirmDialog } from '../ui.js';
import {
  activeAccount, signIn, signOut, syncNow, storageUse, bringDeviceDataIn, skipDeviceData, hasValidToken, drive,
} from '../sync/account.js';
import { getSetting, setSetting, deleteTest } from '../db.js';
import { isOpenDeletion } from '../sync/merge.js';
import { makeBackupBlob } from './backup.js';

const ago = (ms) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(new Date(ms).toISOString());
};

export async function render(root) {
  const page = h('div', { class: 'page narrow account-page' });
  root.replaceChildren(page);
  const status = h('p', { class: 'small', role: 'status', id: 'sync-status' });
  const say = (cls, text) => { status.className = `${cls} small`; status.textContent = text; };

  async function draw() {
    const a = activeAccount();
    if (!a) return drawSignedOut();
    const last = await getSetting('sync.lastSyncedAt', null);
    const err = await getSetting('sync.lastError', null);
    const deletions = (await getSetting('sync.deletions', [])).filter((d) => isOpenDeletion(d));
    const replaced = await getSetting('sync.replaced', []);
    const testsHere = new Set((await (await import('../db.js')).listTests()).map((t) => t.id));
    const open = deletions.filter((d) => testsHere.has(d.id));
    const storage = h('div', { id: 'storage-use' }, h('p', { class: 'muted small' }, 'Press "Show storage" to see how much space sync uses in your Drive.'));
    fill(page,
      h('h1', null, 'Account & sync'),
      h('section', { class: 'card' },
        h('p', null, 'Signed in as ', h('strong', { id: 'account-email' }, a.email || a.name || 'your Google account'), a.name && a.email ? ` (${a.name})` : ''),
        h('p', { id: 'last-synced' }, 'Last synced: ', h('strong', null, ago(last))),
        err ? h('div', { class: 'box box-warn', id: 'sync-error' }, err.message) : null,
        h('div', { class: 'test-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', id: 'sync-now', onClick: (e) => runSync(e.target) }, 'Sync now'),
          h('button', { type: 'button', class: 'btn', id: 'show-storage', onClick: () => showStorage(storage) }, 'Show storage'),
          h('button', { type: 'button', class: 'btn', id: 'sign-out', onClick: askSignOut }, 'Sign out')),
        status,
        h('p', { class: 'muted small' }, 'Your tests, question pictures, attempts, tags and settings are copied to a hidden folder in YOUR Google Drive that only this app can use. ',
          'Everything also stays on this device and works without internet. ', h('a', { href: '#/privacy' }, 'Privacy'), '.'),
        storage),
      open.length ? h('section', { class: 'card', id: 'open-deletions' },
        h('h2', null, 'Deleted on your other device'),
        h('p', { class: 'small' }, 'These tests were deleted on another device signed in to this account. Nothing is removed here unless you say so.'),
        h('ul', { class: 'plain-list' }, open.map((d) => h('li', { dataset: { test: d.id } },
          h('strong', null, d.name || d.id), h('span', { class: 'muted small' }, ` — deleted ${ago(d.at)} `),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', id: `remove-${d.id}`, onClick: () => decide(d, true) }, 'Remove here too'), ' ',
          h('button', { type: 'button', class: 'btn btn-small', id: `keep-${d.id}`, onClick: () => decide(d, false) }, 'Keep it'))))) : null,
      replaced.length ? h('details', { class: 'card', id: 'replaced-log' },
        h('summary', null, `Changes from other devices (${replaced.length}, last 30 days)`),
        h('p', { class: 'muted small' }, 'When the same thing was changed on two devices, the later change was kept. Here is what was replaced on this device.'),
        h('ul', { class: 'plain-list small' }, replaced.slice().reverse().map((x) => h('li', null,
          `${ago(x.loggedAt)}: ${x.kind || 'item'} ${x.id || ''} — ${x.field}: "${show(x.value)}" → "${show(x.by)}"`)))) : null,
      h('section', { class: 'card' },
        h('h2', null, 'Remove your data from Drive'),
        h('p', { class: 'small' }, 'Deletes the app\'s hidden folder contents in your Google Drive. Your data on this device is not touched; other devices keep their copies too (and would upload them again at their next sync).'),
        h('button', { type: 'button', class: 'btn btn-danger', id: 'delete-cloud', onClick: deleteCloud }, 'Delete my cloud data')));
  }

  function drawSignedOut() {
    fill(page,
      h('h1', null, 'Account & sync'),
      h('section', { class: 'card' },
        h('p', null, 'Signing in is optional. Without it, everything works on this device as before.'),
        h('p', null, 'If you sign in with Google, your tests (with their question pictures), attempts, tags, settings and game progress are copied to a hidden folder in ', h('strong', null, 'your own'), ' Google Drive, and every device where you sign in gets the same data.'),
        h('ul', { class: 'small' },
          h('li', null, 'The app can only use its own hidden folder in your Drive. It cannot see your other files.'),
          h('li', null, 'Nobody else (not even the app\'s maker) can see your data: there is no server in between.'),
          h('li', null, 'Before the first sync the app saves a backup file of this device.')),
        h('button', { type: 'button', class: 'btn btn-primary', id: 'sign-in', onClick: (e) => doSignIn(e.target) }, 'Sign in with Google'),
        status,
        h('p', { class: 'muted small' }, h('a', { href: '#/privacy' }, 'Privacy'), ' · The sign-in window is Google\'s own; the app never sees your password.')));
  }

  async function doSignIn(btn) {
    btn.disabled = true;
    say('muted', 'Opening Google sign-in…');
    try {
      const { account, deviceCounts } = await signIn();
      if (deviceCounts && (deviceCounts.tests || deviceCounts.attempts)) {
        const bring = await confirmDialog({
          title: 'Bring this device\'s data into your account?',
          message: [`This device has ${deviceCounts.tests} test(s) and ${deviceCounts.attempts} submitted attempt(s) saved without sign-in.`,
            'Bring them into your account? A backup file of this device is saved first. Nothing is deleted: after signing out you see this device\'s data as before.'],
          okText: 'Bring them in', cancelText: 'Not now',
        });
        if (bring) {
          say('muted', 'Saving a backup file first…');
          await saveSafetyBackup();
          await bringDeviceDataIn(account);
        } else await skipDeviceData();
      } else await skipDeviceData();
      await draw();
      await runSync(page.querySelector('#sync-now'));
    } catch (e) {
      say('error', e.message);
      btn.disabled = false;
    }
  }

  async function saveSafetyBackup() {
    const { blob } = await makeBackupBlob();
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `cat-practice-lab-before-first-sync-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await setSetting('lastBackupAt', new Date().toISOString());
  }

  async function runSync(btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await syncNow({ interactive: true, onProgress: (t) => say('muted', `${t}…`) });
      say('ok', `Synced. ${r.uploaded} file(s) sent, ${r.downloaded} received.` + (r.replaced ? ` ${r.replaced} change(s) from another device were newer.` : '') + (r.waiting ? ` ${r.waiting} PDF(s) are still being uploaded by your other device; they arrive at the next sync.` : ''));
    } catch (e) {
      say('error', e.message);
    }
    const msg = status.textContent; const cls = status.className;
    await draw();
    status.className = cls; status.textContent = msg;
    status.dataset.finished = String(Date.now()); // each finished sync is told apart (also by the tests)
  }

  async function showStorage(box) {
    fill(box, h('p', { class: 'muted small' }, 'Asking Google…'));
    try {
      if (!hasValidToken()) throw new Error('Press "Sync now" first (the Google permission needs renewing).');
      const s = await storageUse();
      fill(box, h('table', { class: 'facts' }, h('tbody', null,
        h('tr', null, h('th', null, 'This app in your Drive'), h('td', { id: 'app-bytes' }, `${formatBytes(s.appBytes)} in ${s.files} file(s)`)),
        h('tr', null, h('th', null, 'Your Google storage'), h('td', null, s.driveLimit ? `${formatBytes(s.driveUsage)} used of ${formatBytes(s.driveLimit)}` : `${formatBytes(s.driveUsage)} used`)))));
    } catch (e) {
      fill(box, h('p', { class: 'error small' }, e.message));
    }
  }

  async function decide(d, remove) {
    if (remove) {
      const ok = await confirmDialog({ title: `Remove "${d.name}" here too?`, message: 'The test, its attempts here, and its PDF\'s questions (if no other test uses them) are removed from this device.', okText: 'Remove', cancelText: 'Cancel', danger: true });
      if (!ok) return;
      await deleteTest(d.id);
    } else {
      const list = await getSetting('sync.deletions', []);
      await setSetting('sync.deletions', list.map((x) => (x.kind === d.kind && x.id === d.id ? { ...x, keptAt: Date.now() } : x)));
    }
    await runSync(null);
  }

  async function askSignOut() {
    const choice = await signOutDialog();
    if (!choice) return;
    await signOut({ keepCopy: choice === 'keep' });
    location.hash = '#/account';
    location.reload();
  }

  async function deleteCloud() {
    const ok = await confirmDialog({ title: 'Delete your data from Google Drive?', message: ['All of this app\'s files in your Drive are deleted. This device keeps everything.', 'Your other devices still have their copies and would upload them again when they sync.'], okText: 'Delete from Drive', cancelText: 'Cancel', danger: true });
    if (!ok) return;
    try {
      if (!hasValidToken()) throw new Error('Press "Sync now" first (the Google permission needs renewing), then try again.');
      const d = drive();
      for (const f of await d.list()) await d.remove(f.id);
      await setSetting('sync.files', {});
      say('ok', 'Your data was deleted from Google Drive.');
    } catch (e) {
      say('error', e.message);
    }
  }

  await draw();
  return null;
}

const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));

/** "Sign out": keep a copy on this device (pre-selected) or remove it from this device. */
function signOutDialog() {
  return new Promise((resolve) => {
    const keep = h('input', { type: 'radio', name: 'signout', value: 'keep', id: 'signout-keep', checked: true });
    const remove = h('input', { type: 'radio', name: 'signout', value: 'remove', id: 'signout-remove' });
    const dlg = h('dialog', { class: 'dialog', id: 'signout-dialog' },
      h('h2', null, 'Sign out'),
      h('p', null, 'Your data stays safe in your Google Drive either way. What should happen on this device?'),
      h('label', { class: 'choice' }, keep, h('span', null, h('strong', null, 'Keep a copy on this device'), h('br'), h('span', { class: 'small muted' }, 'You see it again when you sign in here next time.'))),
      h('label', { class: 'choice' }, remove, h('span', null, h('strong', null, 'Remove this account\'s data from this device'), h('br'), h('span', { class: 'small muted' }, 'For a shared or borrowed device. It comes back from Drive when you sign in again.'))),
      h('p', { class: 'small' }, 'After signing out, the app shows this device\'s own data (what was here without sign-in).'),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', type: 'button', onClick: () => dlg.close('cancel') }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', id: 'signout-confirm', onClick: () => dlg.close(remove.checked ? 'remove' : 'keep') }, 'Sign out')));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'cancel' || !dlg.returnValue ? null : dlg.returnValue); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
