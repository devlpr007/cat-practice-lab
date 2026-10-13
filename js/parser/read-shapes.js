// Reading labels, answer-key values, headings and option markers by SHAPE (for PDFs without a
// text layer). Pure code on grey-scale page images; unit-testable in Node.
// Nothing here guesses: every character must match a reference shape clearly (see glyphs.js),
// otherwise the result is marked unclear and the caller refuses or asks the user.
import { BOLD, REGULAR, WORDS } from './glyph-templates.js';
import {
  decodeGrid, glyphFeature, boxFeature, bestMatch, isClear, gridSimilarity,
  WORD_MIN_SCORE, WORD_MIN_MARGIN,
} from './glyphs.js';
import { labelGlyphs, lineGlyphs } from './layout.js';
import { inkBox, INK } from './raster.js';

const prep = (list) => list.map((t) => ({ ...t, grid: decodeGrid(t.grid) }));
const T = { bold: prep(BOLD), regular: prep(REGULAR), words: prep(WORDS) };
const pick = (set, chars) => set.filter((t) => chars.includes(t.char));
const DIGITS = [...'0123456789'];
const SETS = {
  labelStart: pick(T.bold, ['Q', ...DIGITS]),
  digits: pick(T.bold, DIGITS),
  keyStart: pick(T.bold, ['(', ')', ...DIGITS]),
  keyLetter: pick(T.bold, ['A', 'B', 'C', 'D', ...DIGITS]),
  // inside "( )" an answer-key value is always a letter: numbers are written without brackets
  keyLetterOnly: pick(T.bold, ['A', 'B', 'C', 'D']),
  keyEnd: pick(T.bold, ['(', ')', ...DIGITS]),
  markerParen: pick(T.regular, ['(', ')']),
  markerLetter: pick(T.regular, ['A', 'B', 'C', 'D']),
};

/** Is the glyph's height plausible for this template (same font size within +-45%)? */
function sizeOk(glyph, match, set, scale) {
  const t = set.find((x) => x.char === match.char);
  if (!t || !t.heightPt) return true;
  const ratio = (glyph.y1 - glyph.y0) / scale / t.heightPt;
  return ratio > 0.55 && ratio < 1.45;
}

function classify(glyph, cc, set, scale) {
  const m = bestMatch(glyphFeature(glyph, cc), set);
  const clear = isClear(m) && sizeOk(glyph, m, set, scale);
  return { char: m.char, score: +m.score.toFixed(3), second: m.secondChar, secondScore: +m.second.toFixed(3), clear };
}

/**
 * Read the "Q<n>" label at the start of a line. Returns
 * { n (number or null), text, clear, box, glyphs: [classification...] }.
 */
export function readLabel(img, colRect, band, scale) {
  const g = labelGlyphs(img, colRect, band, 4 * scale);
  // some PDFs print the label with a full stop ("Q1."): a small blob sitting on the baseline after
  // the digits is that stop, not a character of the number
  const lastC = g.comps[g.comps.length - 1];
  const prevC = g.comps[g.comps.length - 2];
  if (g.comps.length >= 3 && lastC && prevC) {
    const hPrev = prevC.y1 - prevC.y0;
    const small = (lastC.x1 - lastC.x0) < 0.4 * hPrev && (lastC.y1 - lastC.y0) < 0.4 * hPrev;
    const onBaseline = Math.abs(lastC.y1 - prevC.y1) < 0.2 * hPrev;
    if (small && onBaseline) {
      g.comps = g.comps.slice(0, -1);
      g.box = { ...g.box, x1: Math.max(...g.comps.map((c) => c.x1)) };
    }
  }
  if (g.comps.length < 2) return { n: null, text: '?', clear: false, box: g.box, glyphs: [] };
  const glyphs = g.comps.map((c, k) => classify(c, g.cc, k === 0 ? SETS.labelStart : SETS.digits, scale));
  const text = glyphs.map((x) => (x.clear ? x.char : '?')).join('');
  const clear = glyphs.every((x) => x.clear) && glyphs[0].char === 'Q' && text.length <= 4;
  return { n: clear ? Number(text.slice(1)) : null, text, clear, box: g.box, glyphs };
}

/**
 * Read an answer-key value to the right of a label: "(A)".."(D)" (MCQ) or digits (TITA).
 * Returns { value: 'A'..'D' | '1234' | null, kind: 'letter' | 'number' | null, clear, box, glyphs }.
 */
export function readKeyValue(img, colRect, band, labelBox, scale) {
  const rect = { x0: labelBox.x1 + 3 * scale, x1: colRect.x1, y0: band.y0, y1: band.y1 };
  const lg = lineGlyphs(img, rect);
  const gl = lg.glyphs;
  if (!gl.length) return { value: null, kind: null, clear: false, box: null, glyphs: [], missing: true };
  const box = {
    x0: Math.min(...gl.map((c) => c.x0)), x1: Math.max(...gl.map((c) => c.x1)),
    y0: Math.min(...gl.map((c) => c.y0)), y1: Math.max(...gl.map((c) => c.y1)),
  };
  const first = classify(gl[0], lg.cc, SETS.keyStart, scale);
  if (first.clear && first.char === '(') {
    const glyphs = [first];
    if (gl.length === 3) {
      glyphs.push(classify(gl[1], lg.cc, SETS.keyLetterOnly, scale));
      glyphs.push(classify(gl[2], lg.cc, SETS.keyEnd, scale));
    }
    const ok = gl.length === 3 && glyphs.every((x) => x.clear) && /^[A-D]$/.test(glyphs[1].char) && glyphs[2].char === ')';
    return { value: ok ? glyphs[1].char : null, kind: ok ? 'letter' : null, clear: ok, box, glyphs };
  }
  const glyphs = gl.map((c) => classify(c, lg.cc, SETS.digits, scale));
  const ok = glyphs.every((x) => x.clear) && gl.length <= 6;
  return { value: ok ? glyphs.map((x) => x.char).join('') : null, kind: ok ? 'number' : null, clear: ok, box, glyphs };
}

/** Compare the ink inside `box` with the stored headings. Returns { word, score, clear }. */
export function readHeading(img, box) {
  if (!box || box.x1 - box.x0 < 4 || box.y1 - box.y0 < 4) return { word: null, score: 0, clear: false };
  const m = bestMatch(boxFeature(img, box, INK), T.words, gridSimilarity);
  return { word: m.char, score: +m.score.toFixed(3), clear: isClear(m, WORD_MIN_SCORE, WORD_MIN_MARGIN) };
}

/** Section heading ("Answer Key" / "Hints & Solutions") in the area above the text columns, or null. */
export function findSectionTitle(img, layoutTop) {
  const rows = [];
  let start = -1;
  for (let y = 0; y <= layoutTop; y++) {
    let dark = false;
    if (y < layoutTop) {
      const row = y * img.width;
      for (let x = 0; x < img.width; x++) if (img.gray[row + x] < INK) { dark = true; break; }
    }
    if (dark && start < 0) start = y;
    if (!dark && start >= 0) { rows.push({ y0: start, y1: y }); start = -1; }
  }
  for (const r of rows) {
    const box = inkBox(img, { x0: 0, x1: img.width, y0: r.y0, y1: r.y1 }, INK);
    const h = readHeading(img, box);
    if (h.clear && (h.word === 'Answer Key' || h.word === 'Hints & Solutions')) return { title: h.word, box, score: h.score };
  }
  return null;
}

/** Does this line (from x0 to the column edge) read "Video Solution:"? */
export function isVideoSolutionLine(img, colRect, band, x0) {
  const box = inkBox(img, { x0, x1: colRect.x1, y0: band.y0, y1: band.y1 }, INK);
  const h = readHeading(img, box);
  return h.clear && h.word === 'Video Solution:';
}

/** Does the rest of a solution label line read "Text Solution:"? */
export function isTextSolutionLine(img, colRect, band, labelBox, scale) {
  const box = inkBox(img, { x0: labelBox.x1 + 3 * scale, x1: colRect.x1, y0: band.y0, y1: band.y1 }, INK);
  const h = readHeading(img, box);
  return h.clear && h.word === 'Text Solution:';
}

/**
 * Option markers "(A)".."(D)" on one line, left to right: [{ letter, x0, x1, y0, y1 }].
 * A marker needs a clear "(", a clear letter A-D and a clear ")" next to each other.
 */
export function findOptionMarkers(img, colRect, band, x0, scale) {
  const lg = lineGlyphs(img, { x0, x1: colRect.x1, y0: band.y0, y1: band.y1 });
  const g = lg.glyphs;
  const found = [];
  const thin = (q) => (q.x1 - q.x0) / (q.y1 - q.y0) < 0.6;
  for (let i = 0; i + 2 < g.length; i++) {
    const [a, b, c] = [g[i], g[i + 1], g[i + 2]];
    if (!thin(a) || !thin(c) || b.x0 - a.x1 > 2.5 * scale || c.x0 - b.x1 > 2.5 * scale) continue;
    const ca = classify(a, lg.cc, SETS.markerParen, scale);
    if (!ca.clear || ca.char !== '(') continue;
    const cc = classify(c, lg.cc, SETS.markerParen, scale);
    if (!cc.clear || cc.char !== ')') continue;
    const cb = classify(b, lg.cc, SETS.markerLetter, scale);
    if (!cb.clear) continue;
    found.push({ letter: cb.char, x0: a.x0, x1: c.x1, y0: Math.min(a.y0, c.y0), y1: Math.max(a.y1, c.y1), score: Math.min(ca.score, cb.score, cc.score) });
    i += 2;
  }
  return found;
}
