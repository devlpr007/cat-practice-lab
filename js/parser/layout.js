// Page layout analysis on rendered page images (pure code, unit-testable in Node).
// Works in pixels of an image rendered at `scale` (1 = 72 dpi); results keep `scale` so callers
// can convert to points (pt = px / scale).
import { verticalLines, rowProfile, runs, inkBox, components, MARK, INK } from './raster.js';

/**
 * The thin vertical rule between the two text columns: the longest thin vertical line in the
 * middle 40% of the page that is at least 12% of the page height. Null if there is none.
 */
export function findDivider(img, scale, dividerX = null) {
  let lines = dividerCandidates(img, scale);
  // when the document's column-line position is known, only a line at that position counts
  // (a table border elsewhere is not the column line)
  if (dividerX !== null) lines = lines.filter((l) => Math.abs((l.x0 + l.x1) / 2 - dividerX) <= 3 * scale);
  return lines[0] || null;
}

/** Thin, long vertical lines in the middle of the page, longest first. */
export function dividerCandidates(img, scale) {
  const lines = verticalLines(img, img.width * 0.3, img.width * 0.7, img.height * 0.12)
    .filter((l) => l.x1 - l.x0 <= 4 * scale);
  return lines.sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0));
}

/** The column-line position shared by most pages (pixels), or null. */
export function commonDividerX(candidatesPerPage, scale) {
  const xs = candidatesPerPage.filter((c) => c.length).map((c) => (c[0].x0 + c[0].x1) / 2).sort((a, b) => a - b);
  if (!xs.length) return null;
  let best = null;
  for (const x of xs) {
    const n = xs.filter((y) => Math.abs(y - x) <= 3 * scale).length;
    if (!best || n > best.n) best = { x, n };
  }
  return best.x;
}

/**
 * Text lines ("bands") of one column: runs of rows that contain anything non-white, each with the
 * box of its content. Rows are not merged, so two lines separated by one white row are two bands.
 */
export function columnBands(img, rect) {
  return runs(rowProfile(img, rect, MARK), { offset: Math.max(0, Math.floor(rect.y0)) })
    .map((r) => {
      const box = inkBox(img, { x0: rect.x0, x1: rect.x1, y0: r.start, y1: r.end }, MARK);
      return { y0: r.start, y1: r.end, x0: box.x0, x1: box.x1 };
    });
}

/**
 * Layout of one page: divider, content area (the divider's height plus a small margin) and the
 * two columns with their text lines. Header, badge and footer lie outside the content area.
 */
export function pageLayout(img, scale, { bottomLimit = null, dividerX = null, keep = [] } = {}) {
  const divider = findDivider(img, scale, dividerX);
  if (!divider) return { scale, divider: null, columns: [] };
  const margin = 3 * scale;
  const top = Math.max(0, divider.y0 - margin);
  const bottom = Math.min(img.height, divider.y1 + margin, bottomLimit ?? Infinity);
  const gap = 2 * scale;
  const rects = [
    { x0: 0, x1: divider.x0 - gap, y0: top, y1: bottom },
    { x0: divider.x1 + gap, x1: img.width, y0: top, y1: bottom },
  ];
  const overflow = removeOverflow(img, divider, top, bottom, scale, keep);
  return {
    scale,
    divider,
    top,
    bottom,
    overflow,
    columns: rects.map((r, index) => ({ index, ...r, bands: columnBands(img, r) })),
  };
}

/**
 * Content of the LEFT column that sticks out across the column line (e.g. a table wider than its
 * column) touches the line from the right side. Such pieces are erased from this analysis image so
 * they are not mistaken for right-column content, and returned as boxes so the left column's
 * pictures can be widened to include them. (The pictures themselves are cut from a fresh render.)
 */
export function removeOverflow(img, divider, top, bottom, scale, keep = []) {
  const x0 = divider.x1 + Math.max(1, Math.round(0.4 * scale));
  const cc = components(img, { x0, x1: Math.min(img.width, divider.x1 + 60 * scale), y0: top, y1: bottom }, MARK);
  const boxes = [];
  const w = cc.rect.x1 - cc.rect.x0;
  // the left column reaches the line on these rows?
  const leftReaches = (c) => inkBox(img, { x0: divider.x0 - 4 * scale, x1: divider.x0, y0: c.y0 - scale, y1: c.y1 + scale }, MARK) !== null;
  for (const c of cc.comps) {
    if (c.x0 > divider.x1 + 6 * scale) continue; // right-column text starts well away from the line
    if (!leftReaches(c)) continue;               // e.g. a right-column diagram that starts near the line
    if (c.y1 - c.y0 < 2 * scale && c.x1 - c.x0 < 2 * scale) continue; // a tiny speck
    // erase exactly this component's pixels, except inside `keep` boxes (right-column text known
    // from the text layer, e.g. a "Q3." label touched by a left-column table that runs over)
    const kept = keep.filter((k) => k.x0 < c.x1 && k.x1 > c.x0 && k.y0 < c.y1 && k.y1 > c.y0);
    // A table that runs over the line ends in its right border (a long vertical line). Anything
    // glued to the right of that border (e.g. the "Q" of a "Q8." label printed against it) is
    // right-column content: erase only up to the border.
    const isMine = (x, y) => cc.labels[(y - cc.rect.y0) * w + (x - cc.rect.x0)] === c.id;
    let borderX = null;
    for (let x = c.x1 - 1; x >= c.x0 && borderX === null; x--) {
      let run = 0; let best = 0;
      for (let y = c.y0; y < c.y1; y++) { run = isMine(x, y) ? run + 1 : 0; if (run > best) best = run; }
      if (best >= 12 * scale) borderX = x;
    }
    const xEnd = borderX !== null && borderX < c.x1 - 2 ? borderX + Math.max(1, Math.round(0.5 * scale)) : c.x1;
    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < xEnd; x++) {
        if (kept.some((k) => x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1)) continue;
        if (cc.labels[(y - cc.rect.y0) * w + (x - cc.rect.x0)] === c.id) img.gray[y * img.width + x] = 255;
      }
    }
    boxes.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  }
  return boxes;
}

/**
 * Layout of a page that has NO line between the columns (the last page of a section, where the text
 * fits in the left column only). The column positions and the top edge come from the other pages
 * (`ref` = { x0, x1, top, bottom } of their column line), the bottom from the footer when known.
 * Lines at the top that have ink where the column line would be (e.g. "Hints & Solutions" heading,
 * its note and rule) are returned as `heading`; any such line further down is counted in `crossing`
 * (unexpected for this format — the caller refuses the PDF).
 */
export function layoutWithoutDivider(img, scale, ref, bottomLimit = null) {
  const top = Math.max(0, Math.floor(ref.top - 3 * scale));
  const bottom = Math.min(img.height, Math.ceil(bottomLimit ?? ref.bottom + 3 * scale));
  const rows = runs(rowProfile(img, { x0: 0, x1: img.width, y0: top, y1: bottom }, MARK), { offset: top });
  const mid = (ref.x0 + ref.x1) / 2;
  const nearDivider = (r) => inkBox(img, { x0: mid - 6 * scale, x1: mid + 6 * scale, y0: r.start, y1: r.end }, MARK) !== null;
  const heading = [];
  let k = 0;
  while (k < rows.length && nearDivider(rows[k])) {
    heading.push(inkBox(img, { x0: 0, x1: img.width, y0: rows[k].start, y1: rows[k].end }, MARK));
    k++;
  }
  const contentTop = heading.length ? heading[heading.length - 1].y1 + 1 : top;
  const crossing = rows.slice(k).filter(nearDivider).length;
  const gap = 2 * scale;
  const rects = [
    { x0: 0, x1: ref.x0 - gap, y0: contentTop, y1: bottom },
    { x0: ref.x1 + gap, x1: img.width, y0: contentTop, y1: bottom },
  ];
  return {
    scale,
    divider: { x0: ref.x0, x1: ref.x1, y0: contentTop, y1: bottom },
    synthetic: true,
    top: contentTop,
    bottom,
    heading,
    crossing,
    columns: rects.map((r, index) => ({ index, ...r, bands: columnBands(img, r) })),
  };
}

/**
 * Where labels ("Q12") end and indented text begins, per column, across all pages of a document.
 * Labels start at the very left of a column; question/solution text is indented. Returns
 * [{ labelX, textX, boundary }] per column (pixels), or null when no clear gap is found.
 */
export function labelBoundaries(layouts) {
  const out = [];
  const scale = (layouts.find((L) => L.divider) || {}).scale || 1;
  for (const col of [0, 1]) {
    const starts = [];
    for (const L of layouts) {
      if (!L.divider) continue;
      // a line that starts right at the column's cut edge is something clipped there (e.g. a pale,
      // wide column line bleeding into the column), not a real start of text
      for (const b of L.columns[col].bands) if (b.x0 > L.columns[col].x0 + 0.5 * scale) starts.push(b.x0);
    }
    // group line starts that are within 1.5 pt of each other; a position counts only if at least
    // 3 lines start there (so one diagram poking into the margin cannot move the label position)
    starts.sort((a, b) => a - b);
    const clusters = [];
    for (const x of starts) {
      const c = clusters[clusters.length - 1];
      if (c && x - c.last <= 1.5 * scale) { c.n++; c.last = x; } else clusters.push({ x, last: x, n: 1 });
    }
    const common = clusters.filter((c) => c.n >= 3);
    const label = common[0];
    const text = label && common.find((c) => c.x > label.last + 5 * scale);
    if (!label || !text) { out.push(null); continue; }
    out.push({ labelX: label.x, textX: text.x, boundary: (label.last + text.x) / 2 });
  }
  return out;
}

/**
 * Glyphs of the label at the start of a band: the connected components from the left edge of the
 * line up to the first wide gap (wider than `maxGap` pixels). Returns { comps, box, cc } where
 * cc is the components() result (needed to read each component's exact pixels).
 */
export function labelGlyphs(img, colRect, band, maxGap) {
  const cc = components(img, { x0: colRect.x0, x1: colRect.x1, y0: band.y0, y1: band.y1 }, INK);
  const all = cc.comps.slice().sort((a, b) => a.x0 - b.x0);
  // only components on the same text line as the first (leftmost) one, e.g. not a QR code above
  const first = all[0];
  const sorted = first
    ? all.filter((c) => { const mid = (c.y0 + c.y1) / 2; return mid > first.y0 && mid < first.y1; })
    : all;
  const comps = [];
  let right = -Infinity;
  for (const c of sorted) {
    if (comps.length && c.x0 - right > maxGap) break;
    comps.push(c);
    right = Math.max(right, c.x1);
  }
  // merge components that overlap horizontally (e.g. the dot of an "i", or a broken glyph)
  const merged = [];
  for (const c of comps) {
    const last = merged[merged.length - 1];
    // a full stop tucked under the overhang of a "7" ("Q7.") overlaps it horizontally but is a
    // separate small mark on the baseline: keep it apart (an "i" dot sits on top and is merged)
    const lh = last ? last.y1 - last.y0 : 0;
    const stopUnder = last && (c.x1 - c.x0) < 0.4 * lh && (c.y1 - c.y0) < 0.4 * lh && c.y0 >= last.y0 + 0.6 * lh;
    if (last && c.x0 < last.x1 - 1 && !stopUnder) {
      last.parts.push(c);
      last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1);
      last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1);
    } else {
      merged.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, parts: [c] });
    }
  }
  if (!merged.length) return { comps: [], box: null, cc };
  const box = {
    x0: Math.min(...merged.map((c) => c.x0)), x1: Math.max(...merged.map((c) => c.x1)),
    y0: Math.min(...merged.map((c) => c.y0)), y1: Math.max(...merged.map((c) => c.y1)),
  };
  return { comps: merged, box, cc };
}

/** Components of a line inside [x0, x1), grouped into glyphs (horizontally overlapping parts merged). */
export function lineGlyphs(img, rect) {
  const cc = components(img, rect, INK);
  const sorted = cc.comps.slice().sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.x0 < last.x1 - 1) {
      last.parts.push(c);
      last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1);
      last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1);
    } else {
      merged.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, parts: [c] });
    }
  }
  return { glyphs: merged, cc };
}
