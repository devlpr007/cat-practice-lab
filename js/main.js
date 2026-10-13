// App start-up and page switching (#/library, #/add, #/test/<id>, #/settings, #/sectional, ...).
import { h } from './ui.js';
import { gameOnByDefault } from './game/defaults.js';
import { openDb, requestPersistentStorage, fillMissingTopics, getSetting } from './db.js';
import { openActiveDatabase } from './sync/account.js';

const pages = {
  library: () => import('./pages/library.js'),
  add: () => import('./pages/add-pdf.js'),
  test: () => import('./pages/test-view.js'),
  settings: () => import('./pages/settings-page.js'),
  exam: () => import('./pages/exam.js'),
  result: () => import('./pages/result.js'),
  sectional: () => import('./pages/sectional.js'),
  feedback: () => import('./pages/feedback.js'),
  backup: () => import('./pages/backup.js'),
  dojo: () => import('./pages/dojo.js'),
  credits: () => import('./pages/credits.js'),
  account: () => import('./pages/account.js'),
  privacy: () => import('./pages/privacy.js'),
};

const root = document.getElementById('app');
let current = null;
let currentHash = null;
let navigating = false;

function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const name = pages[parts[0]] ? parts[0] : 'library';
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  if (name === 'test' || name === 'exam' || name === 'result') params.id = decodeURIComponent(parts[1] || '');
  if (name === 'library' && parts[1]) params.section = parts[1];
  if (name === 'library' && parts[2]) params.topic = decodeURIComponent(parts[2]);
  if (name === 'sectional' && parts[1]) params.view = parts[1];
  if (name === 'dojo' && parts[1]) params.section = parts[1];
  return { name, params };
}

let pending = false;
/** Whether game effects are on (set at start-up and when Settings changes it). */
let gameEffects = false;
export function setGameEffects(on) { gameEffects = !!on; }

async function route() {
  // a page change requested while another page is still loading is done right after it
  if (navigating) { pending = true; return; }
  navigating = true;
  pending = false;
  try {
    if (current && current.canLeave && location.hash !== currentHash) {
      if (!(await current.canLeave())) {
        history.replaceState(null, '', currentHash);
        return;
      }
    }
    const { name, params } = parseHash();
    // game pages: ink-cloud transition (with the dojo's medallion when entering a dojo); never on the test screen
    const prev = currentHash ? parseHash(currentHash) : null;
    if (name === 'dojo' && gameEffects && !document.body.classList.contains('in-exam') && currentHash !== null) {
      const { inkTransition } = await import('./game/transition.js');
      const dojoKey = ['quant', 'varc', 'lrdi'].includes(params.section) && prev?.params?.section !== params.section ? params.section : null;
      await inkTransition({ dojoKey });
    }
    if (current && current.cleanup) current.cleanup();
    current = null;
    currentHash = location.hash;
    const navName = name === 'dojo' && params.section === 'progress' ? 'progress' : name;
    for (const a of document.querySelectorAll('.topbar nav a')) a.classList.toggle('active', a.dataset.page === navName);
    root.replaceChildren(h('p', { class: 'muted page' }, 'Loading…'));
    const mod = await pages[name]();
    current = (await mod.render(root, params)) || null;
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    root.replaceChildren(h('div', { class: 'page narrow' }, h('div', { class: 'box box-error' },
      h('h2', null, 'Something went wrong'),
      h('p', null, String(err && err.message ? err.message : err)),
      h('p', null, h('a', { href: '#/library' }, 'Back to the library')))));
  } finally {
    navigating = false;
    if (pending || location.hash !== currentHash) route();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (current && current.hasUnsaved && current.hasUnsaved()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

(async () => {
  try {
    await openActiveDatabase(); // the signed-in account's own data on this device (or the device's own)
    await openDb();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('div', { class: 'box box-error' },
      h('h2', null, 'This browser cannot store data for the app'),
      h('p', null, 'Storage may be turned off (for example in a private window). Please open the app in a normal Chrome or Edge window.'),
      h('p', { class: 'small' }, String(err && err.message ? err.message : err)))));
    return;
  }
  try { await fillMissingTopics(); } catch (err) { console.error(err); }
  showGameLink(await getSetting('game.enabled', gameOnByDefault()));
  setGameEffects((await getSetting('game.enabled', gameOnByDefault())) && !(await getSetting('game.reduceEffects', false)) && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  requestPersistentStorage();
  route();
  registerOffline();
})();


/** The samurai game (Stage 6) adds a "Dojo" link to the top bar only when it is switched on. */
export function showGameLink(on) {
  for (const id of ['nav-dojo', 'nav-progress']) { const a = document.getElementById(id); if (a) a.hidden = !on; }
  document.body.classList.toggle('themed', !!on); // themed top bar; the test screen has its own header
}

/**
 * Offline use: the service worker (sw.js) keeps the app files on this device. A new version is used
 * only after the user agrees (never during a test) or the next time the app is opened.
 */
function registerOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller || document.getElementById('update-ready')) return;
      const bar = h('div', { class: 'update-bar', id: 'update-ready', role: 'status' },
        'A new version of the app is ready. ',
        h('button', { type: 'button', class: 'btn btn-small', onClick: () => {
          if (document.body.classList.contains('in-exam')) return;
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
          reg.waiting.postMessage('activate-update');
        } }, 'Use it now'),
        ' (or it starts the next time you open the app).');
      document.body.append(bar);
    };
    offer();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', offer));
  }).catch((err) => console.warn('Offline mode not available:', err));
}
