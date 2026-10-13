// Shape comparison for PDFs without a text layer (pure code, no AI, unit-testable in Node).
// A shape (one character, or a whole word) is turned into a small grid of ink coverage values
// (0 = white, 1 = fully inked), keeping its proportions, and compared with stored reference
// shapes taken from a known-good PDF. The comparison is deterministic: same picture, same answer.

export const GLYPH_GRID = 32;               // characters: 32 x 32 cells
export const WORD_GRID = { w: 96, h: 16 };  // words / headings: 96 x 16 cells

/**
 * Coverage grid of the ink inside `box` (pixels; x1/y1 exclusive), aspect ratio preserved and centred.
 * `isInk(x, y)` decides which pixels count (lets callers use only one connected component).
 */
export function coverageGrid(box, isInk, gw, gh) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const s = Math.min(gw / w, gh / h);
  const offX = (gw - w * s) / 2;
  const offY = (gh - h * s) / 2;
  const grid = new Float32Array(gw * gh);
  // per pixel column / row: which grid cells it overlaps and by how much (in grid units)
  const spans = (n, off) => {
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = off + i * s;
      const b = off + (i + 1) * s;
      const parts = [];
      for (let c = Math.floor(a); c < Math.ceil(b); c++) {
        const ov = Math.min(b, c + 1) - Math.max(a, c);
        if (ov > 0) parts.push(c, ov);
      }
      list.push(parts);
    }
    return list;
  };
  const xs = spans(w, offX);
  const ys = spans(h, offY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isInk(box.x0 + x, box.y0 + y)) continue;
      const py = ys[y];
      const px = xs[x];
      for (let j = 0; j < py.length; j += 2) {
        for (let i = 0; i < px.length; i += 2) {
          grid[py[j] * gw + px[i]] += py[j + 1] * px[i + 1];
        }
      }
    }
  }
  for (let i = 0; i < grid.length; i++) if (grid[i] > 1) grid[i] = 1;
  return grid;
}

/**
 * Feature of one glyph = one or more connected components (`glyph.parts`, from layout.js).
 * Only the glyph's own pixels count, so a neighbouring character inside the box is ignored.
 * `cc` is the components() result the parts came from.
 */
export function glyphFeature(glyph, cc, n = GLYPH_GRID) {
  const ids = new Set(glyph.parts.map((p) => p.id));
  const lw = cc.rect.x1 - cc.rect.x0;
  const isInk = (x, y) => ids.has(cc.labels[(y - cc.rect.y0) * lw + (x - cc.rect.x0)]);
  return {
    aspect: (glyph.x1 - glyph.x0) / (glyph.y1 - glyph.y0),
    height: glyph.y1 - glyph.y0,
    grid: coverageGrid(glyph, isInk, n, n),
  };
}

/** Feature of everything inked inside a box (used for whole words/headings). */
export function boxFeature(img, box, thr, gw = WORD_GRID.w, gh = WORD_GRID.h) {
  const isInk = (x, y) => img.gray[y * img.width + x] < thr;
  return {
    aspect: (box.x1 - box.x0) / (box.y1 - box.y0),
    height: box.y1 - box.y0,
    grid: coverageGrid(box, isInk, gw, gh),
  };
}

/** Similarity of two coverage grids, 0..1 (Dice coefficient on coverage). */
export function gridSimilarity(a, b) {
  let inter = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    inter += Math.min(a[i], b[i]);
    sum += a[i] + b[i];
  }
  return sum === 0 ? 0 : (2 * inter) / sum;
}

/**
 * Shift-tolerant similarity, 0..1: the share of A's inked cells that lie within one cell of B's
 * ink, and vice versa; the smaller of the two. Extra strokes (an "8" compared with a "3") lower it
 * sharply, while a one-cell offset caused by rendering does not.
 */
export function tolerantSimilarity(a, b, gw, gh, on = 0.35) {
  const near = (g, x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= gh) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < gw && g[yy * gw + xx] >= on) return true;
      }
    }
    return false;
  };
  let aOn = 0, aHit = 0, bOn = 0, bHit = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (a[i] >= on) { aOn++; if (near(b, x, y)) aHit++; }
      if (b[i] >= on) { bOn++; if (near(a, x, y)) bHit++; }
    }
  }
  if (!aOn || !bOn) return 0;
  return Math.min(aHit / aOn, bHit / bOn);
}

/**
 * Similarity used for single characters: the average of the plain overlap (Dice) and the
 * shift-tolerant overlap. Chosen because it separated look-alikes (3/8, 5/8) best on the sample
 * at five different render sizes (see PROGRESS.md, Stage 1).
 */
export function glyphSimilarity(a, b) {
  return (gridSimilarity(a, b) + tolerantSimilarity(a, b, GLYPH_GRID, GLYPH_GRID)) / 2;
}

/** Shapes whose proportions differ by more than this factor are never considered a match. */
export const MAX_ASPECT_RATIO_DIFF = 1.35;

/**
 * Compare a feature with reference templates [{ char, aspect, grid }] using `similarity`.
 * Returns { char, score, secondChar, second } — the caller decides whether it is clear enough.
 */
export function bestMatch(feature, templates, similarity = glyphSimilarity) {
  const scores = new Map();
  for (const t of templates) {
    const ratio = Math.max(feature.aspect / t.aspect, t.aspect / feature.aspect);
    const score = ratio > MAX_ASPECT_RATIO_DIFF ? 0 : similarity(feature.grid, t.grid);
    if (score > (scores.get(t.char) ?? -1)) scores.set(t.char, score);
  }
  const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]);
  const [c1, s1] = ranked[0] || [null, 0];
  const [c2, s2] = ranked[1] || [null, 0];
  return { char: s1 > 0 ? c1 : null, score: s1, secondChar: c2, second: s2 };
}

/**
 * Rules for a "clear" match; anything else is reported as unreadable and never guessed.
 * On the sample, correct characters scored at least 0.87 with a lead of at least 0.093 over the
 * next candidate, at every render size tested; these limits leave a safety gap below that.
 */
export const MIN_SCORE = 0.8;
export const MIN_MARGIN = 0.05;
/** Whole headings ("Answer Key", "Video Solution:") use plain overlap on a wide grid. */
export const WORD_MIN_SCORE = 0.75;
export const WORD_MIN_MARGIN = 0.15;

export function isClear(m, minScore = MIN_SCORE, minMargin = MIN_MARGIN) {
  return m.char !== null && m.score >= minScore && m.score - m.second >= minMargin;
}

/** Templates are stored as hex strings (one 0..15 level per cell) to keep the source file small. */
export function encodeGrid(grid) {
  let s = '';
  for (const v of grid) s += Math.round(v * 15).toString(16);
  return s;
}

export function decodeGrid(hex) {
  const g = new Float32Array(hex.length);
  for (let i = 0; i < hex.length; i++) g[i] = parseInt(hex[i], 16) / 15;
  return g;
}
