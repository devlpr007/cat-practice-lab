// Reading labels, answer-key values, headings and option markers from a PDF's TEXT LAYER
// (pure code, unit-testable in Node). Only short, fixed tokens are taken from the text layer —
// "Q12", "(B)", "1297", "Answer Key", "Video Solution:" — never the maths, which these PDFs
// scramble. Positions always come from the rendered page (bands), the text only says what they are.
// Text items: { str, x0, x1, yTop, yBottom, fontSize } in points; bands/rects in pixels at `scale`.
import { subjectFromText } from './filename.js';

export function itemsInBand(items, colRect, band, scale) {
  return items
    .filter((it) => {
      const cy = ((it.yTop + it.yBottom) / 2) * scale;
      const cx = ((it.x0 + it.x1) / 2) * scale; // an item belongs to the column holding its middle
      return cy >= band.y0 - scale && cy <= band.y1 + scale && cx >= colRect.x0 && cx < colRect.x1;
    })
    .sort((a, b) => a.x0 - b.x0);
}

export function lineText(items) {
  let s = '';
  let prev = null;
  for (const it of items) {
    if (prev && it.x0 - prev.x1 > 0.2 * (it.fontSize || 10)) s += ' ';
    s += it.str;
    prev = it;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** "Q<n>" at the start of the line, if the line starts in the label margin. */
export function readLabelText(items, colRect, band, boundaryPx, scale) {
  const all = itemsInBand(items, colRect, band, scale);
  // First try: only the band's first text line, without words that start left of this column (a
  // band can hold more lines when a table printed over the column line joins them, LR / DI DPPs).
  // Otherwise: the whole band, as before (a tall formula on the label's line, Quant DPPs).
  const own = all.filter((it) => it.x0 * scale >= colRect.x0);
  const top = own.length ? Math.min(...own.map((it) => it.yTop)) : 0;
  const firstLine = own.filter((it) => it.yTop < top + 0.6 * (it.yBottom - it.yTop));
  return labelFromLine(firstLine, boundaryPx, scale) || labelFromLine(all, boundaryPx, scale) || { n: null, text: lineText(all), clear: false };
}

function labelFromLine(line, boundaryPx, scale) {
  if (!line.length || line[0].x0 * scale > boundaryPx + 2 * scale) return null;
  const text = lineText(line);
  const m = text.match(/^Q\s*(\d{1,3})(?!\d)/);
  if (!m) return null;
  const first = line[0];
  const textBox = /^Q\s*\d/.test(first.str.trim())
    ? { x0: first.x0 * scale, x1: (first.x0 + (first.x1 - first.x0) * Math.min(1, m[0].length / first.str.length)) * scale, y0: first.yTop * scale, y1: first.yBottom * scale }
    : null;
  return { n: Number(m[1]), text: 'Q' + Number(m[1]), clear: true, rest: text.slice(m[0].length).trim(), textBox };
}

/**
 * A "Directions (1-5) …" line that starts a passage set, or null. Returns { from, to } (numbers,
 * or null when the line gives no range).
 */
export function readDirectionsText(items, colRect, band, scale) {
  const text = lineText(itemsInBand(items, colRect, band, scale));
  // a set heading: "Directions (1-5) …", "Directions: …", "Directions for questions 6 to 10 …"
  // (not an ordinary sentence that happens to start with "direction")
  if (!/^Directions?\s*(\(|:|for\b|\d)/i.test(text) || /^direction\b(?!s)/.test(text)) return null;
  const m = text.match(/^directions?\s*(?:for\s*questions?\s*)?\(?\s*(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})/i);
  return m ? { from: Number(m[1]), to: Number(m[2]) } : { from: null, to: null };
}

/** Parse an answer-key value: "(C)" / "C" -> letter, "1297" / "-2" / "0.5" -> number. */
export function parseKeyValueText(rest) {
  const t = String(rest || '').trim();
  let m = t.match(/^\(\s*([A-Da-d])\s*\)$/) || t.match(/^([A-D])$/);
  if (m) return { value: m[1].toUpperCase(), kind: 'letter', clear: true };
  m = t.match(/^-?\d+(\.\d+)?$/);
  if (m) return { value: t, kind: 'number', clear: true };
  return { value: null, kind: null, clear: false, raw: t };
}

/** "Answer Key" / "Hints & Solutions" heading above the text columns (y < topPx), or null. */
export function findSectionTitleText(items, topPx, scale) {
  const above = items.filter((it) => it.yBottom * scale <= topPx);
  const text = lineText(above.sort((a, b) => a.yTop - b.yTop || a.x0 - b.x0));
  if (/answer\s*key/i.test(text)) return { title: 'Answer Key' };
  if (/hints?\s*(&|and)\s*solutions?/i.test(text)) return { title: 'Hints & Solutions' };
  return null;
}

/** Section heading from the text inside one box (pixels), or null. */
export function findSectionTitleInBox(items, box, scale) {
  const inside = items.filter((it) => {
    const cy = ((it.yTop + it.yBottom) / 2) * scale;
    return cy >= box.y0 - scale && cy <= box.y1 + scale;
  });
  // read line by line (top to bottom, then left to right), never across two lines
  const text = lineText(inside.sort((a, b) => (Math.abs(a.yTop - b.yTop) > 3 ? a.yTop - b.yTop : a.x0 - b.x0)));
  if (/answer\s*key/i.test(text)) return { title: 'Answer Key' };
  if (/hints?\s*(&|and)\s*solutions?/i.test(text)) return { title: 'Hints & Solutions' };
  return null;
}

/**
 * Where a "Video Solution:" heading starts inside a line band (pixels), or null if the band has none.
 * Tolerates a stray symbol next to it (a formula from the other column poking in) and a formula
 * line glued above it (then the heading starts below the band's top and the caller splits there).
 */
export function videoSolutionTop(items, colRect, band, scale) {
  const line = itemsInBand(items, colRect, band, scale);
  const v = line.find((it) => /video/i.test(it.str));
  if (!v) return null;
  const onOrBelow = line.filter((it) => (it.yTop + it.yBottom) / 2 >= v.yTop);
  if (lineText(onOrBelow).replace(/[^A-Za-z]/g, '').toLowerCase() !== 'videosolution') return null;
  return Math.max(band.y0, Math.floor(v.yTop * scale - scale));
}

export function isVideoSolutionText(items, colRect, band, scale) {
  return videoSolutionTop(items, colRect, band, scale) !== null;
}

export function isTextSolutionText(items, colRect, band, scale) {
  return /text\s*solution/i.test(lineText(itemsInBand(items, colRect, band, scale)));
}

/**
 * Option markers on one line from the text layer, with APPROXIMATE positions (pixels), left to right.
 * Callers refine the positions on the rendered image.
 */
export function findOptionMarkersText(items, colRect, band, scale) {
  const out = [];
  for (const it of itemsInBand(items, colRect, band, scale)) {
    const re = /\(\s*([A-D])\s*\)/g;
    let m;
    const len = it.str.length || 1;
    const w = it.x1 - it.x0;
    while ((m = re.exec(it.str))) {
      const x0 = (it.x0 + (w * m.index) / len) * scale;
      const x1 = (it.x0 + (w * (m.index + m[0].length)) / len) * scale;
      out.push({ letter: m[1], x0, x1, y0: band.y0, y1: band.y1, approx: true });
    }
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

/** Subject / topic / DPP number from the page-1 heading text (suggestion only). */
export function headerFromText(items, topPx, scale) {
  const above = items.filter((it) => it.yBottom * scale <= topPx).sort((a, b) => a.yTop - b.yTop || a.x0 - b.x0);
  const lines = [];
  for (const it of above) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.yTop) < (it.fontSize || 10) * 0.5) last.items.push(it);
    else lines.push({ y: it.yTop, items: [it] });
  }
  const texts = lines.map((l) => lineText(l.items.sort((a, b) => a.x0 - b.x0)));
  let subject = null, topic = null, dpp = null;
  texts.forEach((t) => {
    const d = t.match(/\bDPP\s*[:#-]?\s*(\d{1,3})\b/i);
    if (d && !dpp) dpp = d[1];
  });
  const clean = (t) => t.replace(/\bDPP\s*[:#-]?\s*\d{1,3}\b/i, '').trim();
  const si = texts.findIndex((t) => subjectFromText(clean(t)));
  if (si >= 0) {
    subject = subjectFromText(clean(texts[si]));
    for (let k = si + 1; k < texts.length; k++) {
      const t = clean(texts[k]);
      if (t && !/^MBA\b/i.test(t)) { topic = t; break; }
    }
  }
  return { subject, topic, dpp };
}
