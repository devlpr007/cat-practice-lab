// #/privacy — what the app does with data, in plain words. Only true statements; keep it in step
// with the code (sync/account.js, sync/drive.js, sync/config.js) whenever those change.
import { h } from '../ui.js';
import { GOOGLE_SCOPES } from '../sync/config.js';

export const PRIVACY_UPDATED = '13 October 2026';

export async function render(root) {
  const sec = (title, ...body) => h('section', { class: 'card' }, h('h2', null, title), ...body);
  root.replaceChildren(h('div', { class: 'page narrow privacy' },
    h('h1', null, 'Privacy'),
    h('p', { class: 'muted small' }, `CAT Practice Lab · last updated ${PRIVACY_UPDATED}`),
    sec('In short',
      h('ul', null,
        h('li', null, 'The app has no server and no database of its own. Your data is kept on your device and, only if you sign in, in your own Google Drive.'),
        h('li', null, 'The app\'s maker cannot see your PDFs, questions, answers or results.'),
        h('li', null, 'No advertising, no analytics, no tracking, and the app sets no cookies.'),
        h('li', null, 'The app contains no institute material. Add only PDFs you have the right to use. Questions, solutions and answer keys in the PDFs you add remain the property of their publishers; the app is not affiliated with them.'))),
    sec('Where the app comes from',
      h('p', null, 'The app\'s files (its code, pictures and fonts) are hosted on GitHub Pages, a service of GitHub, Inc. When your browser downloads them, GitHub receives the usual technical details of any web visit (such as your IP address and browser type), as described in GitHub\'s own privacy statement. None of your study data is ever sent to GitHub.'),
      h('p', null, 'After the first visit the app keeps its files on your device, so it also starts without internet.')),
    sec('Data on your device',
      h('p', null, 'The PDFs you add are read on your device. The app keeps the question and solution pictures, answer keys, your attempts, tags, notes and settings in your browser\'s storage on this device. Clearing the browser\'s data for this site deletes them, so keep a backup (Backup page) or sign in to sync.')),
    sec('If you sign in with Google (optional)',
      h('p', null, 'Signing in uses Google\'s own sign-in window; the app never sees your password. When you press "Sign in with Google", the app loads Google\'s sign-in code from Google. The app asks Google for:'),
      h('ul', null,
        h('li', null, h('strong', null, 'Your name and email address'), ' — to show which account is signed in and to keep each account\'s data separate on a shared device.'),
        h('li', null, h('strong', null, 'Permission to use the app\'s own hidden folder in your Google Drive'), ' ("drive.appdata"). The app cannot see, open or change any of your other Drive files, and other apps cannot see this folder.')),
      h('p', null, 'In that folder the app keeps a copy of your tests (with their question and solution pictures), attempts, tags, notes, settings and the information the game is worked out from, so every device where you sign in shows the same data. The files count towards your own Google storage. They go directly from your device to Google: there is no server of the app\'s maker in between.'),
      h('p', null, 'The permission Google gives the app lasts about an hour and is kept only in the browser\'s memory for this session. The app remembers on your device which account is signed in (a random-looking key, your email and name).'),
      h('p', { class: 'muted small' }, `Permissions requested: ${GOOGLE_SCOPES}`)),
    sec('Removing your data',
      h('ul', null,
        h('li', null, h('strong', null, 'From Google Drive: '), 'Account page → "Delete my cloud data". You can also remove it in Google Drive (on a computer): Settings → Manage apps → CAT Practice Lab → Options → Delete hidden app data.'),
        h('li', null, h('strong', null, 'The app\'s access to your Google account: '), 'Google Account → Security → Your connections to third-party apps & services → CAT Practice Lab → Delete all connections.'),
        h('li', null, h('strong', null, 'From this device: '), 'sign out and choose "Remove this account\'s data from this device"; for data saved without sign-in, clear this site\'s data in the browser settings.'))),
    sec('Ask AI',
      h('p', null, 'The app never sends anything to any AI. The "Ask AI" button only prepares a message and a picture that you can copy or share yourself to an app of your choice.')),
    sec('Contact',
      h('p', null, 'Questions about this page: ', h('a', { href: 'https://www.linkedin.com/in/abhijeet-singh-bit/', target: '_blank', rel: 'noopener' }, 'contact the maker on LinkedIn'), '.'))));
  return null;
}
