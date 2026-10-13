// Stage 5: #/backup — save everything to one file, restore (merge) from such a file, CSV export,
// last-backup date, and a plain-language note on how data can be lost.
import { h, fill, formatDate, formatBytes, confirmDialog } from '../ui.js';
import {
  exportAll, existingForMerge, applyRestore, getSetting, setSetting, listTests,
  listAllAttempts, listAllQuestionAttempts, listQuestions, listSources, storageStatus,
} from '../db.js';
import {
  BACKUP_FORMAT, BACKUP_VERSION, isLocalOnlySetting, backupProblems, planMerge, mergeSummaryText,
  daysSince, needsReminder, answersCsv, bytesToBase64, base64ToBytes, REMIND_AFTER_DAYS,
} from '../backup.js';
import { MISTAKE_REASONS } from '../model.js';
import { APP_VERSION } from '../version.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Build the backup file as a Blob (pictures as base64, written piece by piece). */
export async function makeBackupBlob() {
  const all = await exportAll();
  const stores = {
    sources: all.sources, questions: all.questions, tests: all.tests, attempts: all.attempts,
    questionAttempts: all.questionAttempts, settings: all.settings.filter((s) => !isLocalOnlySetting(s.key)),
  };
  const counts = {
    tests: all.tests.length, questions: all.questions.length, attempts: all.attempts.filter((a) => a.status === 'submitted').length,
    unfinished: all.attempts.filter((a) => a.status !== 'submitted').length, pictures: all.images.length,
  };
  const head = { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), counts };
  const parts = [JSON.stringify(head).slice(0, -1), ',"stores":', JSON.stringify(stores), ',"images":['];
  let first = true;
  for (const im of all.images) {
    const bytes = new Uint8Array(await im.blob.arrayBuffer());
    parts.push((first ? '' : ',') + JSON.stringify({ id: im.id, sourceId: im.sourceId, width: im.width, height: im.height, type: im.blob.type || 'image/png', data: bytesToBase64(bytes) }));
    first = false;
  }
  parts.push(']}');
  return { blob: new Blob(parts, { type: 'application/json' }), counts };
}

/** Read and check a backup file. Returns { data, problems }. */
export async function readBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { data: null, problems: ['This file could not be read as a CAT Practice Lab backup (it is not a backup file, or it is incomplete).'] };
  }
  return { data, problems: backupProblems(data) };
}

/** Merge a checked backup into this device. Returns the plan that was applied. */
export async function restoreBackup(data) {
  const plan = planMerge(await existingForMerge(), { ...data.stores, images: data.images });
  const want = new Set(plan.images);
  const images = data.images.filter((im) => want.has(im.id)).map((im) => ({
    id: im.id, sourceId: im.sourceId, width: im.width, height: im.height,
    blob: new Blob([base64ToBytes(im.data)], { type: im.type || 'image/png' }),
  }));
  await applyRestore(plan.put, images);
  return plan;
}

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Reminder box for other pages (Library): null when not needed. */
export async function backupReminder() {
  const [last, tests] = await Promise.all([getSetting('lastBackupAt', null), listTests()]);
  if (!needsReminder(last, tests.length > 0)) return null;
  const d = daysSince(last);
  return h('div', { class: 'box box-warn', id: 'backup-reminder', role: 'status' },
    h('strong', null, d === null ? 'You have not made a backup yet. ' : `Your last backup was ${d} days ago. `),
    'If this browser\'s data is cleared, your tests and results are gone. ',
    h('a', { href: '#/backup' }, 'Make a backup now'), '.');
}

export async function render(root) {
  const page = h('div', { class: 'page narrow' });
  root.replaceChildren(page);
  const status = h('div', { id: 'backup-status' });
  const makeMsg = h('div', { role: 'status', id: 'make-msg' });
  const restoreMsg = h('div', { role: 'status', id: 'restore-msg' });
  const csvMsg = h('p', { role: 'status', class: 'small', id: 'csv-msg' });
  const fileIn = h('input', { type: 'file', id: 'restore-input', class: 'visually-hidden', accept: '.json,application/json' });

  async function drawStatus() {
    const last = await getSetting('lastBackupAt', null);
    const info = await getSetting('lastBackupInfo', null);
    const tests = await listTests();
    const d = daysSince(last);
    fill(status, h('div', { class: `box ${needsReminder(last, tests.length > 0) ? 'box-warn' : 'box-ok'}` },
      last
        ? [h('strong', null, `Last backup: ${formatDate(last)}`), d === 0 ? ' (today)' : ` (${d} day${d === 1 ? '' : 's'} ago)`,
          info ? h('span', { class: 'muted small' }, ` · ${info.tests} tests, ${info.attempts} attempts, ${formatBytes(info.size)}`) : null]
        : h('strong', null, 'No backup made on this device yet.'),
      h('p', { class: 'small', style: { margin: '6px 0 0' } }, `The app reminds you when the last backup is ${REMIND_AFTER_DAYS} or more days old.`)));
  }

  const make = async (share) => {
    fill(makeMsg, h('p', { class: 'muted' }, 'Making the backup file…'));
    try {
      const { blob, counts } = await makeBackupBlob();
      const name = `cat-practice-lab-backup-${today()}.json`;
      if (share) {
        const file = new File([blob], name, { type: 'application/json' });
        await navigator.share({ files: [file], title: 'CAT Practice Lab backup' });
      } else saveFile(blob, name);
      await setSetting('lastBackupAt', new Date().toISOString());
      await setSetting('lastBackupInfo', { tests: counts.tests, attempts: counts.attempts, size: blob.size });
      fill(makeMsg, h('div', { class: 'box box-ok' },
        h('strong', null, share ? 'Backup shared. ' : `Saved "${name}" `), share ? '' : '(usually in your Downloads folder). ',
        `It has ${counts.tests} tests, ${counts.questions} questions, ${counts.attempts} submitted attempts` + (counts.unfinished ? ` and ${counts.unfinished} unfinished` : '') + ` (${formatBytes(blob.size)}).`));
      drawStatus();
    } catch (err) {
      if (err && err.name === 'AbortError') { fill(makeMsg); return; }
      fill(makeMsg, h('div', { class: 'box box-error' }, 'The backup could not be made: ', String(err && err.message ? err.message : err)));
    }
  };

  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    fill(restoreMsg, h('p', { class: 'muted' }, `Reading ${file.name}…`));
    const { data, problems } = await readBackupFile(file);
    if (problems.length) { fill(restoreMsg, h('div', { class: 'box box-error' }, h('strong', null, 'Not restored. '), h('ul', null, problems.map((p) => h('li', null, p))))); return; }
    const c = data.counts || {};
    const ok = await confirmDialog({
      title: 'Restore from this backup?',
      message: [
        `Backup made on ${formatDate(data.exportedAt)} (app ${data.appVersion || '?'}): ${c.tests ?? data.stores.tests.length} tests, ${c.attempts ?? '?'} submitted attempts.`,
        'Everything in it that is not on this device yet is added. Nothing on this device is deleted or overwritten, except unfinished attempts that the backup has finished.',
      ],
      okText: 'Restore', cancelText: 'Cancel',
    });
    if (!ok) { fill(restoreMsg); return; }
    try {
      const plan = await restoreBackup(data);
      fill(restoreMsg, h('div', { class: 'box box-ok', id: 'restore-done' }, h('strong', null, 'Restored. '), h('ul', null, mergeSummaryText(plan).map((l) => h('li', null, l)))));
    } catch (err) {
      fill(restoreMsg, h('div', { class: 'box box-error' }, 'Nothing was restored (the browser stopped the save): ', String(err && err.message ? err.message : err)));
    }
  });

  const csv = async () => {
    const [attempts, records, questions, sources, tests] = await Promise.all([listAllAttempts(), listAllQuestionAttempts(), listQuestions(), listSources(), listTests()]);
    const labels = new Map(MISTAKE_REASONS.map((m) => [m.code, m.label]));
    const text = answersCsv({ attempts, records, questions, sources, tests, reasonLabel: (c) => labels.get(c) || c });
    saveFile(new Blob([text], { type: 'text/csv;charset=utf-8' }), `cat-practice-lab-answers-${today()}.csv`);
    csvMsg.className = 'ok small';
    csvMsg.textContent = `Saved (${text.split('\r\n').length - 2} answer rows). Open it with Excel or Google Sheets.`;
  };

  const st = await storageStatus();
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });
  fill(page,
    h('h1', null, 'Backup and restore'),
    status,
    h('section', { class: 'card' },
      h('h2', null, 'Make a backup'),
      h('p', null, 'Saves everything — your tests, their pictures, all attempts, mistake reasons, notes and settings — in one file.'),
      h('p', { class: 'muted small' }, 'Keep the file somewhere only you can open: a pen drive, or your own private cloud folder. It contains pictures from your institute PDFs, so do not share it publicly.'),
      h('p', null,
        h('button', { type: 'button', class: 'btn btn-primary', id: 'make-backup', onClick: () => make(false) }, 'Save backup file'), ' ',
        canShare ? h('button', { type: 'button', class: 'btn', id: 'share-backup', onClick: () => make(true) }, 'Share backup file (phone)') : null),
      makeMsg),
    h('section', { class: 'card' },
      h('h2', null, 'Restore from a backup'),
      h('p', null, 'Choose a backup file made on this or another device (for example from your phone on your PC). Its tests and attempts are ADDED to what is here — this is also how you combine phone and PC history. Nothing here is deleted.'),
      h('label', { class: 'btn', for: 'restore-input' }, 'Choose backup file…'), fileIn,
      restoreMsg),
    h('section', { class: 'card' },
      h('h2', null, 'Answers for a spreadsheet (CSV)'),
      h('p', { class: 'muted small' }, 'One row per question per submitted test: date, test, topic, sub-topic, your answer, correct answer, result, marks, time, visits, mistake reason. For reading in Excel / Google Sheets; to restore the app, use the backup file above.'),
      h('button', { type: 'button', class: 'btn', id: 'export-csv', onClick: csv }, 'Save answers as CSV'),
      csvMsg),
    h('section', { class: 'card', id: 'data-loss' },
      h('h2', null, 'How your data could be lost — and how the app protects it'),
      h('ul', null,
        h('li', null, h('strong', null, 'Everything lives only in this browser on this device. '), 'There is no account and no server copy. Another browser, another device, or a private / incognito window has its own, separate data.'),
        h('li', null, h('strong', null, 'Clearing browsing data '), '("Clear history", "Clear site data", cleaner apps) for this site deletes it.'),
        h('li', null, h('strong', null, 'Uninstalling the browser or resetting the phone '), 'deletes it.'),
        h('li', null, h('strong', null, 'Low storage: '), 'a phone browser may clear site data when space runs out, unless storage protection is on. ',
          st.persisted === true ? 'On this device protection is ON.' : st.persisted === false ? 'On this device protection is NOT on yet (see Settings).' : 'This browser does not say whether protection is on.'),
        h('li', null, h('strong', null, 'iPhone / Safari: '), 'Safari can delete data of sites you have not opened for several weeks. Open the app regularly and keep backups.'),
        h('li', null, h('strong', null, 'What the app does: '), 'saves every answer within seconds, asks the browser for storage protection, saves imports in one step (all or nothing), never deletes without asking, and reminds you to back up every 7 days. A backup file is the only copy that survives all of the above.'))));
  drawStatus();
  return null;
}
