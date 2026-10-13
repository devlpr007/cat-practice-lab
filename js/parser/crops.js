// Cutting pictures (questions, options, solutions, answer-key lines) out of rendered pages (browser).
// A crop "spec" is { id, parts: [{ page, rect, whiteouts: [rect] }] } with rectangles in pixels at
// the render scale. Parts are stacked top to bottom in the given order (reading order), white
// margins are trimmed, and the result is encoded as PNG.
import { renderPage } from './pdf.js';
import { encodeGrey4, hasColour } from './png.js';

const GAP = 14;  // pixels of white space between stacked pieces
const PAD = 10;  // pixels of white margin kept around the trimmed picture
const WHITE = 248;

function cutPart(pageCanvas, part) {
  const r = {
    x0: Math.max(0, Math.floor(part.rect.x0)), y0: Math.max(0, Math.floor(part.rect.y0)),
    x1: Math.min(pageCanvas.width, Math.ceil(part.rect.x1)), y1: Math.min(pageCanvas.height, Math.ceil(part.rect.y1)),
  };
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(pageCanvas, r.x0, r.y0, w, h, 0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  for (const wo of part.whiteouts || []) {
    ctx.fillRect(Math.floor(wo.x0 - r.x0) - 1, Math.floor(wo.y0 - r.y0) - 1, Math.ceil(wo.x1 - wo.x0) + 2, Math.ceil(wo.y1 - wo.y0) + 2);
  }
  return c;
}

/** Bounding box of non-white pixels of a canvas, or null if it is blank. */
function contentBox(canvas) {
  const { width: w, height: h } = canvas;
  if (!w || !h) return null;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] < WHITE || d[i + 1] < WHITE || d[i + 2] < WHITE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Stack pieces into one picture. `marks` ([{ partIndex, y }], y relative to that piece) are
 * translated to positions in the final picture (used to know where a question's stem ends).
 */
async function stitch(canvases, marks = []) {
  // trim each piece vertically, but keep a common left edge so text stays aligned
  const kept = canvases.map((c, partIndex) => ({ c, partIndex, b: c ? contentBox(c) : null })).filter((x) => x.b);
  if (!kept.length) return { blob: null, width: 0, height: 0, empty: true, marks: [] };
  const left = Math.min(...kept.map((x) => x.b.x0));
  const right = Math.max(...kept.map((x) => x.b.x1));
  const width = right - left + 2 * PAD;
  const height = kept.reduce((s, x) => s + (x.b.y1 - x.b.y0), 0) + GAP * (kept.length - 1) + 2 * PAD;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = PAD;
  const offsets = new Map();
  for (const { c, b, partIndex } of kept) {
    ctx.drawImage(c, left, b.y0, right - left, b.y1 - b.y0, PAD, y, right - left, b.y1 - b.y0);
    offsets.set(partIndex, { y, b });
    y += b.y1 - b.y0 + GAP;
  }
  const mapped = marks.map((m) => {
    const o = offsets.get(m.partIndex);
    if (!o) return null;
    return Math.max(0, Math.min(height, Math.round(o.y + (m.y - o.b.y0))));
  });
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const blob = hasColour(rgba)
    ? await new Promise((resolve) => out.toBlob(resolve, 'image/png'))
    : new Blob([await encodeGrey4(rgba, width, height)], { type: 'image/png' });
  out.width = out.height = 0;
  return { blob, width, height, empty: false, marks: mapped };
}

/**
 * Render every crop in `specs`. Pages are rendered once each, in order; a crop is finished (and
 * its pieces freed) as soon as its last page has been processed, to keep memory low on phones.
 * Returns Map(id -> { blob, width, height, empty }).
 */
export async function renderCrops(doc, specs, scale, hideRectsByPage, onPage = () => {}, renderOptions = {}) {
  const byPage = new Map();
  const lastPageOf = new Map();
  for (const spec of specs) {
    spec.parts.forEach((part, index) => {
      if (!byPage.has(part.page)) byPage.set(part.page, []);
      byPage.get(part.page).push({ spec, index });
      lastPageOf.set(spec.id, Math.max(lastPageOf.get(spec.id) || 0, part.page));
    });
  }
  const pieces = new Map();
  const results = new Map();
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const page = await doc.getPage(p);
    const { canvas } = await renderPage(page, scale, { ...renderOptions, hideRects: hideRectsByPage.get(p) || [] });
    for (const { spec, index } of byPage.get(p)) {
      if (!pieces.has(spec.id)) pieces.set(spec.id, new Array(spec.parts.length).fill(null));
      pieces.get(spec.id)[index] = cutPart(canvas, spec.parts[index]);
    }
    canvas.width = canvas.height = 0;
    for (const spec of specs) {
      if (lastPageOf.get(spec.id) === p) {
        const marks = (spec.marks || []).map((m) => ({ partIndex: m.partIndex, y: m.y - spec.parts[m.partIndex].rect.y0 }));
        results.set(spec.id, await stitch(pieces.get(spec.id) || [], marks));
        pieces.delete(spec.id);
      }
    }
    onPage(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  for (const spec of specs) if (!results.has(spec.id)) results.set(spec.id, { blob: null, width: 0, height: 0, empty: true, marks: [] });
  return results;
}
