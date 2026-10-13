// Settings: default time limit and marks for new tests, storage status, versions.
import { h, formatBytes } from '../ui.js';
import { gameOnByDefault } from '../game/defaults.js';
import { getDefaults, saveDefaults } from '../settings.js';
import { storageStatus, requestPersistentStorage, getSetting, setSetting, saveDemo, getTest } from '../db.js';
import { buildDemoVarc, DEMO_TEST_ID } from '../demo.js';
import { PARSER_VERSION } from '../parser/parse-pdf.js';
import { PDFJS_VERSION } from '../parser/pdf.js';
import { APP_VERSION } from '../version.js';
import { showGameLink, setGameEffects } from '../main.js';
import { setSoundOn, setAmbienceOn, sfx } from '../game/sound.js';

export async function render(root) {
  const d = await getDefaults();
  const msg = h('p', { role: 'status' });
  const num = (id, value) => h('input', { type: 'number', id, value: String(value), step: 'any', class: 'num' });
  const inputs = {
    time: num('def-time', d.timeLimitMin),
    mcqC: num('def-mcq-correct', d.marking.mcq.correct),
    mcqW: num('def-mcq-wrong', d.marking.mcq.wrong),
    titaC: num('def-tita-correct', d.marking.tita.correct),
    titaW: num('def-tita-wrong', d.marking.tita.wrong),
  };
  const field = (label, control) => h('label', { class: 'field' }, h('span', null, label), control);
  const save = async () => {
    try {
      await saveDefaults({
        timeLimitMin: inputs.time.value,
        marking: { mcq: { correct: inputs.mcqC.value, wrong: inputs.mcqW.value }, tita: { correct: inputs.titaC.value, wrong: inputs.titaW.value } },
      });
      msg.className = 'ok';
      msg.textContent = 'Saved. New tests will use these values (tests already saved keep their own).';
    } catch (err) {
      msg.className = 'error';
      msg.textContent = err.message;
    }
  };
  const st = await storageStatus();
  const persistLine = h('p', null);
  const showPersist = (v) => {
    persistLine.textContent = v === true
      ? 'Storage protection: ON — the browser will not clear this app\'s data on its own when space runs low.'
      : v === false
        ? 'Storage protection: not granted by the browser yet (it is usually granted automatically after you use the app for a while, or once it is installed). Keep regular backups (Backup page).'
        : 'Storage protection: this browser does not report it.';
  };
  showPersist(st.persisted);
  const dir = await getSetting('timerDirection', 'down');
  const dirSel = h('select', { id: 'def-timer-direction' },
    h('option', { value: 'down', selected: dir === 'down' }, 'Count down (time left)'),
    h('option', { value: 'up', selected: dir === 'up' }, 'Count up (time used)'));
  const dirMsg = h('p', { role: 'status', class: 'small' });
  dirSel.addEventListener('change', async () => { await setSetting('timerDirection', dirSel.value); dirMsg.className = 'ok small'; dirMsg.textContent = 'Saved.'; });
  const demoMsg = h('p', { role: 'status', class: 'small' });
  const gameOn = h('input', { type: 'checkbox', id: 'game-enabled', checked: await getSetting('game.enabled', gameOnByDefault()) });
  const fxOff = h('input', { type: 'checkbox', id: 'game-reduce-effects', checked: await getSetting('game.reduceEffects', false) });
  const catDate = h('input', { type: 'date', id: 'game-cat-date', value: (await getSetting('game.catExamDate', null)) || '' });
  const soundOnBox = h('input', { type: 'checkbox', id: 'game-sound', checked: await getSetting('game.sound', gameOnByDefault()) });
  soundOnBox.addEventListener('change', async () => { await setSetting('game.sound', soundOnBox.checked); setSoundOn(soundOnBox.checked); if (soundOnBox.checked) sfx.chime(); gameSaved(soundOnBox.checked ? 'Sound on (battle and page effects only; never during a test).' : 'Sound off.'); });
  const ambientBox = h('input', { type: 'checkbox', id: 'game-ambient', checked: await getSetting('game.ambient', gameOnByDefault()) });
  ambientBox.addEventListener('change', async () => { await setSetting('game.ambient', ambientBox.checked); setAmbienceOn(ambientBox.checked); gameSaved(ambientBox.checked ? 'Dojo ambience on (forge, bamboo wind, crickets inside the dojos).' : 'Dojo ambience off.'); });
  const gameMsg = h('p', { role: 'status', class: 'small' });
  const gameSaved = (text) => { gameMsg.className = 'ok small'; gameMsg.textContent = text; };
  const syncFx = () => setGameEffects(gameOn.checked && !fxOff.checked && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  gameOn.addEventListener('change', async () => { await setSetting('game.enabled', gameOn.checked); showGameLink(gameOn.checked); syncFx(); gameSaved(gameOn.checked ? 'On. Open "Dojo" in the top bar.' : 'Off.'); });
  fxOff.addEventListener('change', async () => { await setSetting('game.reduceEffects', fxOff.checked); syncFx(); gameSaved('Saved.'); });
  catDate.addEventListener('change', async () => { await setSetting('game.catExamDate', catDate.value || null); gameSaved('Saved.'); });
  const hasDemo = !!(await getTest(DEMO_TEST_ID));
  root.replaceChildren(h('div', { class: 'page narrow' },
    h('h1', null, 'Settings'),
    h('section', { class: 'card' },
      h('h2', null, 'Test timer'),
      h('label', { class: 'field' }, h('span', null, 'The timer during a test'), dirSel),
      h('p', { class: 'muted small' }, 'You can also change this on the start screen of each test. The test always ends at its time limit.'),
      dirMsg),
    h('section', { class: 'card', id: 'game-settings' },
      h('h2', null, 'Samurai game (first version)'),
      h('p', { class: 'muted small' }, 'A game layer over your practice: castle, three dojos, ranks, topic bosses and Shadow Scrolls, all worked out from your saved tests (nothing extra is stored). The test screen always stays plain.'),
      h('label', { class: 'check' }, gameOn, ' Show the samurai game'),
      h('label', { class: 'check' }, fxOff, ' Reduce effects (no petals, movement, transitions, animations or vibration)'),
      h('label', { class: 'check' }, soundOnBox, ' Sound (battles, rank-ups, page changes and soft button sounds; never during a test)'),
      h('label', { class: 'check' }, ambientBox, ' Dojo ambience (background sound inside each dojo; needs Sound on)'),
      h('label', { class: 'field' }, h('span', null, 'CAT exam date (for the final-boss countdown)'), catDate),
      gameMsg),
    h('section', { class: 'card' },
      h('h2', null, 'Try the passage screen (VARC / LRDI)'),
      h('p', { class: 'muted small' }, 'Adds a short made-up VARC test (2 passages, 5 questions) so you can try the passage screen without a PDF. You can delete it from the library.'),
      h('button', { class: 'btn', type: 'button', id: 'add-demo', disabled: hasDemo, onClick: async () => {
        const now = new Date().toISOString();
        await saveDemo(await buildDemoVarc(now));
        demoMsg.className = 'ok small';
        demoMsg.textContent = 'Added "Demo VARC test (passage screen)" to the library.';
      } }, hasDemo ? 'Demo test already in the library' : 'Add demo VARC test'),
      demoMsg),
    h('section', { class: 'card' },
      h('h2', null, 'Defaults for new tests'),
      h('p', { class: 'muted small' }, 'Your PDFs have no time limit or marking scheme, so these are used. You can still change them for each test on the review page.'),
      h('div', { class: 'form-grid' },
        field('Time limit (minutes)', inputs.time),
        field('MCQ correct', inputs.mcqC),
        field('MCQ wrong', inputs.mcqW),
        field('TITA correct', inputs.titaC),
        field('TITA wrong', inputs.titaW)),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'save-defaults', onClick: save }, 'Save defaults'),
      msg),
    h('section', { class: 'card' },
      h('h2', null, 'Storage on this device'),
      persistLine,
      st.persisted === false ? h('button', { class: 'btn', type: 'button', onClick: async () => showPersist(await requestPersistentStorage()) }, 'Ask the browser to protect my data') : null,
      h('p', null, `Space used by this app: ${formatBytes(st.usage)}` + (st.quota ? ` (the browser allows up to ${formatBytes(st.quota)})` : '')),
      h('p', { class: 'muted small' }, 'Everything (tests, pictures, attempts) is stored only in this browser on this device. ', h('a', { href: '#/backup' }, 'Backup and restore'), ' keeps a copy in a file.')),
    h('section', { class: 'card' },
      h('h2', null, 'About'),
      h('p', { class: 'muted small' }, `CAT Practice Lab ${APP_VERSION} · PDF reader ${PARSER_VERSION} · PDF.js ${PDFJS_VERSION}. Works offline, no account, no AI inside. `, h('a', { href: '#/credits' }, 'Credits (artwork, fonts, software)')))));
}
