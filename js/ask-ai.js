// Stage 5: "Ask AI" helper. The app calls NO AI: it only prepares a message (text + one picture
// with the question and its solution) that the user copies or shares into any chat app.
// askAiMessage() is pure (unit-tested); combinedPicture() needs a browser (canvas).
import { areaLabel, chapterLabel } from './topics.js';

const SUBJECT_SHORT = { 'Quantitative Aptitude': 'Quantitative Aptitude', VARC: 'VARC', LRDI: 'LRDI' };
const fmt = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * q: the question; row: its result row ({ given, key, result, timeSpentMs }); ref: "PDF name, Q7";
 * related: { group (feedback group of the same sub-topic or null), history ({ seen, wrong } of this
 * question across tests), repeatedInGroup, reasons ([{ label, count }]) } — all from real data.
 */
export function askAiMessage({ q, row, ref, related = {} }) {
  const L = [];
  const where = `${SUBJECT_SHORT[q.subject] || q.subject} › ${areaLabel(q.area)} › ${chapterLabel(q.chapter)}`;
  L.push(`Please help me understand this CAT practice question (${where}; ${ref}).`);
  L.push(`The attached picture shows the question${q.images?.passage ? ', its passage / data' : ''} and the official solution from my institute.`);
  if (q.type === 'MCQ') L.push('It is a multiple-choice question with options A, B, C, D (in the picture, in that order).');
  else L.push('It is a type-in-the-answer (TITA) question: no options.');
  L.push('');
  L.push(`My answer: ${row.given ?? 'I did not answer'}`);
  L.push(`Correct answer (from the answer key): ${row.key}`);
  L.push(`Result: ${row.result === 'correct' ? 'correct' : row.result === 'incorrect' ? 'wrong' : 'skipped'} · time I spent: ${fmt(row.timeSpentMs)}`);
  const past = [];
  const g = related.group;
  if (g && g.answered) past.push(`in ${chapterLabel(q.chapter)} I got ${g.correct} of ${g.answered} right (${g.accuracy}%) over ${plural(g.tests, 'test')}`);
  if (related.history && related.history.seen > 1) past.push(`this question: seen in ${related.history.seen} tests, wrong ${related.history.wrong} times`);
  if (related.repeatedInGroup) past.push(`${plural(related.repeatedInGroup, 'question')} in this sub-topic I got wrong more than once`);
  if (related.reasons?.length) past.push(`mistake reasons I tagged here: ${related.reasons.map((r) => `${r.label.toLowerCase()} ${r.count}`).join(', ')}`);
  if (past.length) {
    L.push('');
    L.push(`My related past mistakes: ${past.join('; ')}.`);
  }
  L.push('');
  L.push('Please:');
  L.push('1. Explain the solution step by step in simple language.');
  L.push(row.result === 'correct' ? '2. Tell me whether there is a faster way than the one I might have used.' : '2. Point out where my answer most likely went wrong.');
  L.push('3. Give me a quick method or check I can use in the exam, if there is one.');
  L.push('4. If anything in the picture is unclear, or you are not sure, say so clearly instead of guessing.');
  return L.join('\n');
}

/** One PNG with labelled parts stacked: Passage (if any), Question, Solution. Browser only. */
export async function combinedPicture(parts, { maxWidth = 1400 } = {}) {
  const bitmaps = [];
  for (const p of parts) if (p.blob) bitmaps.push({ label: p.label, bmp: await createImageBitmap(p.blob) });
  const width = Math.min(maxWidth, Math.max(...bitmaps.map((b) => b.bmp.width), 600));
  const pad = 24;
  const labelH = 44;
  const sizes = bitmaps.map((b) => {
    const s = Math.min(1, (width - 2 * pad) / b.bmp.width);
    return { w: Math.round(b.bmp.width * s), h: Math.round(b.bmp.height * s) };
  });
  const height = pad + sizes.reduce((s, z) => s + labelH + z.h + pad, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = pad;
  bitmaps.forEach((b, i) => {
    ctx.fillStyle = '#0b5a87';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText(b.label, pad, y + 30);
    y += labelH;
    ctx.drawImage(b.bmp, pad, y, sizes[i].w, sizes[i].h);
    y += sizes[i].h + pad;
    if (i < bitmaps.length - 1) {
      ctx.fillStyle = '#d0d7de';
      ctx.fillRect(pad, y - pad / 2, width - 2 * pad, 2);
    }
    b.bmp.close?.();
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
