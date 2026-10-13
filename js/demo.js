// A made-up VARC demo test (two passage sets and one typed-answer question) so the passage screen
// can be tried before VARC/LRDI PDFs can be imported. All text is invented; pictures are drawn here.
import { SCHEMA_VERSION } from './model.js';

const SOURCE_ID = 's-demo-varc';
export const DEMO_TEST_ID = 't-demo-varc';

const PASSAGE_1 = 'Cities have always grown around water. Early settlements needed rivers for drinking, farming and trade, and the river decided where streets ran and where markets met. Today pipes and highways have replaced most of these needs, yet many cities still turn their best land towards the water. Planners argue that this is not nostalgia: open water cools the air, absorbs floods and gives crowded neighbourhoods a shared space that no building can provide. The challenge is to keep that space public as land prices rise along the banks.';
const PASSAGE_2 = 'A small library in a hill town decided to stop charging late fees. Within a year, the number of books returned on time did not fall; instead, borrowers who had stayed away because of unpaid fines came back. The librarians concluded that fees had mainly punished the people who could least afford them, while doing little to change the habits of everyone else.';

const SETS = [
  { setId: 'set-1', passage: PASSAGE_1, questions: [
    { text: 'According to the passage, why did early settlements grow around water?', options: ['For defence against invaders', 'For drinking, farming and trade', 'Because land there was cheaper', 'Because planners chose those sites'], answer: 'B' },
    { text: 'Which benefit of open water is NOT mentioned by the planners?', options: ['Cooling the air', 'Absorbing floods', 'Providing shared space', 'Generating electricity'], answer: 'D' },
    { text: 'What challenge does the author mention at the end?', options: ['Keeping riverside space public', 'Cleaning polluted rivers', 'Building more highways', 'Moving markets inland'], answer: 'A' },
  ] },
  { setId: 'set-2', passage: PASSAGE_2, questions: [
    { text: 'What happened after the library stopped charging late fees?', options: ['Fewer books came back on time', 'Former borrowers came back', 'The library closed', 'Fees were brought back'], answer: 'B' },
    { text: 'In how many years did the library observe the result? Type the number.', options: null, answer: '1' },
  ] },
];

function wrap(ctx, text, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

async function textPicture(text, width = 700, size = 30) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${size}px Arial, sans-serif`;
  const lines = wrap(ctx, text, width - 20);
  const lh = Math.round(size * 1.5);
  c.width = width;
  c.height = lines.length * lh + 20;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111';
  ctx.font = `${size}px Arial, sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 10, 10 + i * lh));
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { blob, width: c.width, height: c.height };
}

export async function buildDemoVarc(nowIso) {
  const images = [];
  const questions = [];
  const add = async (cropId, text, width) => {
    const p = await textPicture(text, width);
    images.push({ id: `${SOURCE_ID}/${cropId}`, sourceId: SOURCE_ID, ...p });
    return `${SOURCE_ID}/${cropId}`;
  };
  let n = 0;
  for (const set of SETS) {
    const passage = await add(`passage-${set.setId}`, set.passage, 900);
    for (const q of set.questions) {
      n++;
      const options = q.options ? {} : null;
      if (q.options) for (const [i, o] of q.options.entries()) options['ABCD'[i]] = await add(`q${n}-opt${'ABCD'[i]}`, o, 600);
      questions.push({
        id: `${SOURCE_ID}/q${n}`, schemaVersion: SCHEMA_VERSION, sourceId: SOURCE_ID, n,
        subject: 'VARC', topic: 'Demo reading comprehension', area: 'RC', chapter: 'Reading Comprehension', subTopic: '',
        type: q.options ? 'MCQ' : 'TITA', answer: q.answer, answerDetected: q.answer, answerEditedByUser: false,
        keyApprovedAt: nowIso, optionsMode: q.options ? 'separate' : 'none', stemHeight: null,
        setId: set.setId,
        images: { question: await add(`q${n}`, q.text, 700), options, solution: await add(`s${n}`, `Demo solution for question ${n}: the answer is ${q.answer}.`, 700), keyStrip: null, passage },
        flags: ['Demo question (made-up text).'], createdAt: nowIso,
      });
    }
  }
  const source = {
    id: SOURCE_ID, schemaVersion: SCHEMA_VERSION, fileName: '(demo, no PDF)', fileSize: 0, sha256: 'demo', pages: 0, kind: 'demo',
    parserVersion: '-', pdfjsVersion: '-', renderScale: 1, name: 'Demo VARC test', subject: 'VARC', topic: 'Demo reading comprehension', area: 'RC', chapter: 'Reading Comprehension',
    dpp: null, createdAt: nowIso, keyApproval: { approvedAt: nowIso, editedCount: 0 }, headerImage: null,
    warnings: ['This is a made-up demo test to try the passage screen. Delete it whenever you like.'],
    questionIds: questions.map((q) => q.id),
  };
  const test = {
    id: DEMO_TEST_ID, schemaVersion: SCHEMA_VERSION, kind: 'pdf', name: 'Demo VARC test (passage screen)', createdAt: nowIso,
    sourceIds: [SOURCE_ID],
    sections: [{ id: 'main', name: 'VARC', subject: 'VARC', style: 'B', questionIds: source.questionIds }],
    settings: { timeLimitMin: 10, marking: { mcq: { correct: 3, wrong: -1 }, tita: { correct: 3, wrong: 0 } } },
  };
  return { source, questions, test, images };
}

/** A made-up 5-question Quant test (used by the automated tests of the test screen). */
export async function buildDemoQuant(nowIso) {
  const SID = 's-demo-quant';
  const items = [
    { text: 'What is 15% of 200?', options: ['20', '30', '40', '45'], answer: 'B' },
    { text: 'A price rises from 80 to 100. By what percent did it rise?', options: ['20%', '25%', '30%', '80%'], answer: 'B' },
    { text: 'How many integers x satisfy 3 < x < 10? Type the number.', options: null, answer: '6' },
    { text: 'If 2x + 3 = 11, what is x?', options: ['2', '3', '4', '5'], answer: 'C' },
    { text: 'What is 12 × 3 − 6? Type the number.', options: null, answer: '30' },
  ];
  const images = [];
  const add = async (cropId, text, width) => {
    const p = await textPicture(text, width);
    images.push({ id: `${SID}/${cropId}`, sourceId: SID, ...p });
    return `${SID}/${cropId}`;
  };
  const questions = [];
  for (const [i, q] of items.entries()) {
    const n = i + 1;
    const options = q.options ? {} : null;
    if (q.options) for (const [k, o] of q.options.entries()) options['ABCD'[k]] = await add(`q${n}-opt${'ABCD'[k]}`, o, 300);
    questions.push({
      id: `${SID}/q${n}`, schemaVersion: SCHEMA_VERSION, sourceId: SID, n,
      subject: 'Quantitative Aptitude', topic: 'Demo arithmetic', area: 'Arithmetic', chapter: 'Percentage', subTopic: '',
      type: q.options ? 'MCQ' : 'TITA', answer: q.answer, answerDetected: q.answer, answerEditedByUser: false,
      keyApprovedAt: nowIso, optionsMode: q.options ? 'separate' : 'none', stemHeight: null,
      images: { question: await add(`q${n}`, q.text, 700), options, solution: await add(`s${n}`, `Solution ${n}: ${q.answer}`, 700), keyStrip: null },
      flags: [], createdAt: nowIso,
    });
  }
  const source = {
    id: SID, schemaVersion: SCHEMA_VERSION, fileName: '(demo, no PDF)', fileSize: 0, sha256: 'demo-quant', pages: 0, kind: 'demo',
    parserVersion: '-', pdfjsVersion: '-', renderScale: 1, name: 'Demo Quant test', subject: 'Quantitative Aptitude', topic: 'Demo arithmetic', area: 'Arithmetic', chapter: 'Percentage',
    dpp: null, createdAt: nowIso, keyApproval: { approvedAt: nowIso, editedCount: 0 }, headerImage: null, warnings: [],
    questionIds: questions.map((q) => q.id),
  };
  const test = {
    id: 't-demo-quant', schemaVersion: SCHEMA_VERSION, kind: 'pdf', name: 'Demo Quant test', createdAt: nowIso, sourceIds: [SID],
    sections: [{ id: 'main', name: 'Quantitative Aptitude', subject: 'Quantitative Aptitude', style: 'A', questionIds: source.questionIds }],
    settings: { timeLimitMin: 10, marking: { mcq: { correct: 3, wrong: -1 }, tita: { correct: 3, wrong: 0 } } },
  };
  return { source, questions, test, images };
}

/** A tiny made-up mock (2 questions per section, 1 minute each) for the automated mock-exam tests. */
export async function buildDemoMock(nowIso) {
  const SID = 's-demo-mock';
  const items = [
    ['varc', 'VARC', 'The passage says the sky is blue. What colour is the sky?', ['Blue', 'Red', 'Green', 'Grey'], 'A'],
    ['varc', 'VARC', 'Sentences 1-4 in order. Type the order.', null, '2143'],
    ['dilr', 'LRDI', 'The chart shows 40 and 60. Sum? Type it.', null, '100'],
    ['dilr', 'LRDI', 'Who sits at seat 2?', ['Asha', 'Bo', 'Cy', 'Dee'], 'C'],
    ['qa', 'Quantitative Aptitude', 'What is 7 × 8?', ['54', '56', '58', '64'], 'B'],
    ['qa', 'Quantitative Aptitude', 'If 3x = 12, x = ? Type it.', null, '4'],
  ];
  const images = [];
  const add = async (cropId, text, width) => { const p = await textPicture(text, width); images.push({ id: `${SID}/${cropId}`, sourceId: SID, ...p }); return `${SID}/${cropId}`; };
  const questions = [];
  for (const [i, [sec, subject, text, opts, answer]] of items.entries()) {
    const n = i + 1;
    const options = opts ? {} : null;
    if (opts) for (const [k, o] of opts.entries()) options['ABCD'[k]] = await add(`q${n}-opt${'ABCD'[k]}`, o, 300);
    questions.push({
      id: `${SID}/q${n}`, schemaVersion: SCHEMA_VERSION, sourceId: SID, n, subject, topic: 'Demo mock', area: 'Mock', chapter: 'Not tagged', subTopic: '',
      type: opts ? 'MCQ' : 'TITA', answer, answerDetected: answer, answerEditedByUser: false, keyApprovedAt: nowIso,
      optionsMode: opts ? 'separate' : 'none', stemHeight: null, mockSection: sec,
      images: { question: await add(`q${n}`, text, 700), options, solution: await add(`s${n}`, `Explanation ${n}: ${answer}`, 700), keyStrip: null, passage: null },
      setId: null, flags: [], createdAt: nowIso,
    });
  }
  const source = {
    id: SID, schemaVersion: SCHEMA_VERSION, format: 'mock', fileName: '(demo mock, no PDF)', fileSize: 0, sha256: 'demo-mock', pages: 0, kind: 'demo', parserVersion: '-', pdfjsVersion: '-', renderScale: 1,
    name: 'Demo mock', subject: 'Mock', topic: 'Demo mock', area: 'Mock', chapter: 'Not tagged', dpp: null, createdAt: nowIso, keyApproval: { approvedAt: nowIso, editedCount: 0 }, headerImage: null, warnings: [], questionIds: questions.map((q) => q.id),
  };
  const secDef = [['varc', 'VARC', 'VARC', 'B'], ['dilr', 'DILR', 'LRDI', 'B'], ['qa', 'QA', 'Quantitative Aptitude', 'A']];
  const test = {
    id: 'm-demo-mock', schemaVersion: SCHEMA_VERSION, kind: 'mock', name: 'Demo mock', createdAt: nowIso, sourceIds: [SID],
    sections: secDef.map(([id, name, subject, style]) => ({ id, name, subject, style, questionIds: questions.filter((q) => q.mockSection === id).map((q) => q.id), timeLimitMin: 1 })),
    settings: { timeLimitMin: 3, marking: { mcq: { correct: 3, wrong: -1 }, tita: { correct: 3, wrong: 0 } } },
    mock: { sectionMinutes: 1, lockedOrder: true },
  };
  return { source, questions, test, images };
}
