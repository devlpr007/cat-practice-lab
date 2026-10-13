// Splitting a document into questions / solutions (pure code, unit-testable in Node).
//
// Input "pages" are plain objects:
//   { page: <1-based page number>, columns: [{ index, x0, x1, bands: [{ y0, y1, x0, x1, label? }] }] }
// where a band (one line of content) may carry `label: { n, ... }` when it starts with "Q<n>".
// Reading order: page by page, left column then right column, top to bottom.

/** All bands of the given pages in reading order, each tagged with its page and column. */
export function readingOrder(pages) {
  const out = [];
  for (const P of pages) {
    for (const col of P.columns) {
      for (const band of col.bands) out.push({ page: P.page, col: col.index, colRect: { x0: col.x0, x1: col.x1 }, band });
    }
  }
  return out;
}

/** Group consecutive entries that share page and column into pieces. */
export function toPieces(entries) {
  const pieces = [];
  for (const e of entries) {
    const last = pieces[pieces.length - 1];
    if (last && last.page === e.page && last.col === e.col) {
      last.bands.push(e.band);
      last.y1 = e.band.y1;
    } else {
      pieces.push({ page: e.page, col: e.col, colRect: e.colRect, bands: [e.band], y0: e.band.y0, y1: e.band.y1 });
    }
  }
  return pieces;
}

/**
 * Split a reading-order list at label bands. Every item runs from its label line up to the next
 * label line. Returns { items: [{ label, entries, pieces }], orphans: [entries before the first label] }.
 */
export function splitAtLabels(entries) {
  const items = [];
  const orphans = [];
  for (const e of entries) {
    if (e.band.label) items.push({ label: e.band.label, entries: [e] });
    else if (items.length) items[items.length - 1].entries.push(e);
    else orphans.push(e);
  }
  for (const it of items) it.pieces = toPieces(it.entries);
  return { items, orphans };
}

/**
 * Like splitAtLabels, but also understands passage sets (VARC / LRDI): a band marked
 * `directions: { from, to }` ("Directions (1-5) Read the following passage…") starts a set; every
 * following line up to the next label is the set's passage (text, chart or table), and the
 * questions after it belong to that set until the next "Directions" line.
 * Returns { items (each with setIndex or null), sets: [{ directions, entries, items }], orphans }.
 */
export function splitWithSets(entries) {
  const items = [];
  const sets = [];
  const orphans = [];
  let inPassage = false;
  let lastN = 0;
  for (const e of entries) {
    const continuing = inPassage && e.band.directions && e.band.directions.from == null;
    // Inside a passage whose range is known ("Directions (11-15)"), a line that looks like a label
    // but is not the next question number is passage text (e.g. "Q1 match …" = Qualifier 1).
    if (inPassage && e.band.label && sets.length) {
      const d = sets[sets.length - 1].directions;
      if (d.from != null && e.band.label.n !== d.from && e.band.label.n !== lastN + 1) {
        e.band.notLabel = e.band.label;
        delete e.band.label;
      }
    }
    if (e.band.directions && !continuing) {
      sets.push({ directions: e.band.directions, entries: [e], items: [] });
      inPassage = true;
    } else if (e.band.label) {
      const setIndex = sets.length ? sets.length - 1 : null;
      const item = { label: e.band.label, entries: [e], setIndex };
      if (e.band.label.n != null) lastN = e.band.label.n;
      items.push(item);
      if (setIndex !== null) sets[setIndex].items.push(item);
      inPassage = false;
    } else if (inPassage) {
      sets[sets.length - 1].entries.push(e);
    } else if (items.length) {
      items[items.length - 1].entries.push(e);
    } else {
      orphans.push(e);
    }
  }
  for (const it of items) it.pieces = toPieces(it.entries);
  return { items, sets, orphans };
}

/** Problems with passage sets: the question numbers after "Directions (a-b)" must be exactly a..b. */
export function setProblems(sets) {
  const problems = [];
  for (const s of sets) {
    const nums = s.items.map((it) => it.label.n);
    const page = s.entries[0].page;
    if (!nums.length) { problems.push(`"Directions" on page ${page} is not followed by any question.`); continue; }
    const { from, to } = s.directions;
    if (from == null || to == null) continue;
    const want = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    if (nums.join(',') !== want.join(',')) {
      problems.push(`"Directions (${from}-${to})" on page ${page} is followed by questions ${nums[0]}–${nums[nums.length - 1]}.`);
    }
  }
  return problems;
}

/** Do the label numbers run 1, 2, 3, ... N without gaps or repeats? Returns a list of problems. */
export function numberingProblems(items, what) {
  const problems = [];
  items.forEach((it, i) => {
    const expected = i + 1;
    if (it.label.n !== expected) {
      problems.push(`${what}: expected Q${expected} but found ${it.label.n == null ? 'an unreadable label' : 'Q' + it.label.n}`
        + ` (page ${it.entries[0].page}).`);
    }
  });
  return problems;
}

/**
 * Option regions for one question, given the option markers found in it.
 * markers: [{ letter, entryIndex, x0, x1, y0, y1 }] in reading order (entryIndex = index into item.entries).
 * Returns null unless exactly A, B, C, D appear once each in that order; otherwise
 * { stem: [entryIndex...], options: { A: { parts: [{ entryIndex, x0, x1, whiteout }] }, ... } }.
 */
export function optionLayout(item, markers) {
  if (markers.length !== 4 || markers.map((m) => m.letter).join('') !== 'ABCD') return null;
  const firstEntry = markers[0].entryIndex;
  if (firstEntry === 0) return null; // options on the label line itself: unusual, fall back
  // rows: markers sharing one entry (line)
  const rows = [];
  for (const m of markers) {
    const row = rows[rows.length - 1];
    if (row && row.entryIndex === m.entryIndex) row.markers.push(m);
    else rows.push({ entryIndex: m.entryIndex, markers: [m] });
  }
  const options = {};
  rows.forEach((row, r) => {
    const next = rows[r + 1];
    const startEntry = item.entries[row.entryIndex];
    // a row continues over following lines of the same column piece, until the next row or the item ends
    const lineIdx = [];
    for (let k = row.entryIndex; k < item.entries.length; k++) {
      if (next && k >= next.entryIndex) break;
      const e = item.entries[k];
      if (e.page !== startEntry.page || e.col !== startEntry.col) break;
      lineIdx.push(k);
    }
    // anything after the row in a different column/page before the next row belongs to the last option of the row
    let spill = [];
    const lastLine = lineIdx[lineIdx.length - 1];
    for (let k = lastLine + 1; k < (next ? next.entryIndex : item.entries.length); k++) spill.push(k);
    row.markers.forEach((m, i) => {
      const right = row.markers[i + 1];
      const x0 = m.x0;
      const x1 = right ? right.x0 : null; // null = to the column's right edge
      const parts = lineIdx.map((k) => ({ entryIndex: k, x0, x1 }));
      if (!right && spill.length) for (const k of spill) parts.push({ entryIndex: k, x0: null, x1: null });
      options[m.letter] = { parts, whiteout: { entryIndex: m.entryIndex, x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1 } };
    });
    if (spill.length && row.markers.length > 1) {
      // content spilling into another column after a multi-option row is ambiguous
      options.__ambiguous = true;
    }
  });
  if (options.__ambiguous) return null;
  const stem = [];
  for (let k = 0; k < firstEntry; k++) stem.push(k);
  return { stem, options };
}
