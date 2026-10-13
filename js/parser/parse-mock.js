// Turn a CAT mock PDF (the one supported format, see mock-structure.js) into a draft mock test
// (browser). Plain deterministic code — no AI, no network. The text layer is used only to find
// labels, headings, option letters and the answer key; every question, option, passage and
// explanation is CUT AS A PICTURE from the rendered pages (maths is partly pictures and partly
// special fonts, so text is never trusted for content).
import { openPdf, pageSize, getImagePlacements, getTextItems, PDFJS_VERSION } from './pdf.js';
import { findStructure, regionParts, validateMockDraft, CONTENT } from './mock-structure.js';
import { renderCrops } from './crops.js';
import { sha256Hex } from './parse-pdf.js';
import { mockNameFromFile } from '../mock-record.js';

export const MOCK_PARSER_VERSION = '1.0.0';
export const MOCK_SCALE = 3;
/** Page-sized pictures (the faint diagonal watermark tiles) are not drawn at all. */
const HIDE_LARGE = { minWidthPt: 350, minHeightPt: 150 };

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Read the text of every page: [{ page, size, items, images }]. */
async function readPages(doc, onProgress) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push({ page: p, size: pageSize(page), items: await getTextItems(page), images: await getImagePlacements(page) });
    if (p % 4 === 0) { onProgress({ step: `Reading the text (page ${p} of ${doc.numPages})`, done: p, total: doc.numPages }); await tick(); }
  }
  return pages;
}

/** 'mock' if the PDF has the mock layout (section headings + an Explanations part), else 'dpp'. */
export async function detectPdfFormat(bytes) {
  // PDF.js takes over the buffer it is given (it is sent to a worker), so detection works on a copy
  const doc = await openPdf(bytes.slice());
  try {
    let section = false; let explanations = false;
    for (let p = 1; p <= doc.numPages; p++) {
      const items = await getTextItems(await doc.getPage(p));
      for (const it of items) {
        if (it.fontSize < 10) continue;
        const t = it.str.replace(/ /g, ' ').trim().toUpperCase();
        if (['VARC', 'LRDI', 'DILR', 'QUANT', 'QA'].includes(t)) section = true;
        if (t === 'EXPLANATIONS') explanations = true;
      }
      if (section && explanations) return 'mock';
    }
    return 'dpp';
  } finally {
    doc.loadingTask.destroy();
  }
}

/**
 * Parse a mock PDF. Returns a draft:
 * { format: 'mock', file, kind: 'text', name, sections, sets, questions, images, structure,
 *   structuralErrors, warnings, report, timings, parserVersion, pdfjsVersion, renderScale }.
 */
export async function parseMock(bytes, { fileName = 'mock.pdf', onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const draft = {
    format: 'mock', kind: 'text', parserVersion: MOCK_PARSER_VERSION, pdfjsVersion: PDFJS_VERSION, renderScale: MOCK_SCALE,
    file: { name: fileName, size: bytes.byteLength, sha256: await sha256Hex(bytes), pages: 0 },
    name: mockNameFromFile(fileName), sections: [], sets: [], questions: [], images: {}, structure: {}, structuralErrors: [], warnings: [], report: null, timings: {},
  };
  const refuse = (msg) => draft.structuralErrors.push(msg);
  onProgress({ step: 'Opening the PDF', done: 0, total: 0 });
  const doc = await openPdf(bytes);
  try {
    draft.file.pages = doc.numPages;
    const pages = await readPages(doc, onProgress);
    if (!pages.some((p) => p.items.length)) { refuse('This PDF has no text layer. Mock PDFs are read from their text; please use the original download.'); return finish(draft, t0); }

    // 1. structure
    const S = findStructure(pages);
    for (const p of S.problems) refuse(p);
    draft.warnings.push(...S.warnings);
    if (draft.structuralErrors.length) return finish(draft, t0);
    const N = S.questions.length;
    draft.sections = S.sections;
    draft.sets = S.sets.map((s, i) => ({ ...s, id: `set-${i + 1}` }));
    const noiseCount = [...S.noise.values()].reduce((a, l) => a + l.length, 0);
    draft.structure = { keyCount: S.key.size, solutionCount: S.solutions.length, noiseCount, labelFont: S.labelFont };

    // 2. crop specs (rectangles in pixels at the render scale)
    const px = (parts) => parts.map((pt) => ({ page: pt.page, rect: scaleRect(pt.rect), whiteouts: pt.whiteouts.map(scaleRect) }));
    const specs = [];
    const setOf = new Map();
    draft.sets.forEach((s) => { for (let n = s.from; n <= s.to; n++) setOf.set(n, s); });
    for (const s of draft.sets) {
      const first = S.questions.find((q) => q.n === s.from);
      if (!first) continue;
      specs.push({ id: `passage-${s.id}`, parts: px(regionParts({ page: s.page, y: s.y }, { page: first.page, y: first.y }, pages, S.noise)) });
    }
    for (const q of S.questions) {
      const parts = regionParts({ page: q.page, y: q.y }, q.end, pages, S.noise);
      const spec = { id: `q${q.n}`, parts: px(parts), marks: [] };
      if (q.options) {
        const a = q.options[0];
        const idx = parts.findIndex((pt) => pt.page === a.page);
        if (idx >= 0) spec.marks.push({ partIndex: idx, y: (a.y - 1.5) * MOCK_SCALE });
        q.options.forEach((o, i) => {
          const nxt = q.options[i + 1];
          const end = nxt ? { page: nxt.page, y: nxt.y } : q.end;
          specs.push({ id: `q${q.n}-opt${o.letter}`, parts: px(regionParts({ page: o.page, y: o.y }, end, pages, S.noise)) });
        });
      }
      specs.push(spec);
      const kr = S.keyRects.get(q.n);
      if (kr) specs.push({ id: `k${q.n}`, parts: [{ page: kr.page, rect: scaleRect(kr), whiteouts: [] }] });
    }
    for (const s of S.solutions) specs.push({ id: `s${s.n}`, parts: px(regionParts({ page: s.page, y: s.y }, s.end, pages, S.noise)) });

    // 3. render and cut (noise pictures are not drawn; the watermark tiles are not drawn)
    const hideByPage = new Map();
    for (const [page, list] of S.noise) hideByPage.set(page, list.filter((n) => n.image).map((n) => n.image));
    const tCrop = performance.now();
    const crops = await renderCrops(doc, specs, MOCK_SCALE, hideByPage, (done, total) => onProgress({ step: `Cutting out pictures (page ${done} of ${total})`, done, total }), { hideLarge: HIDE_LARGE });
    draft.timings.cropsMs = Math.round(performance.now() - tCrop);
    const img = (id) => { const c = crops.get(id); if (!c || c.empty || !c.blob) return null; draft.images[id] = { blob: c.blob, width: c.width, height: c.height }; return id; };

    // 4. assemble the questions
    draft.questions = S.questions.map((q) => {
      const k = S.key.get(q.n) ?? null;
      const issues = [];
      let optionsMode = 'none'; let optionImages = null; let stemHeight = null;
      if (q.options) {
        optionImages = Object.fromEntries(['A', 'B', 'C', 'D'].map((L) => [L, img(`q${q.n}-opt${L}`)]));
        stemHeight = crops.get(`q${q.n}`)?.marks?.[0] ?? null;
        optionsMode = Object.values(optionImages).every(Boolean) && stemHeight > 20 ? 'separate' : 'fallback';
        if (optionsMode === 'fallback') { optionImages = null; stemHeight = null; }
      } else if (q.markersFound) optionsMode = 'fallback';
      if (k && /^[A-D]$/i.test(k) && optionsMode === 'none') optionsMode = 'fallback';
      const set = setOf.get(q.n) || null;
      return {
        n: q.n, section: q.section, setId: set ? set.id : null,
        answer: { detected: k, value: k, edited: false, readClearly: k != null },
        markersFound: q.markersFound, optionsMode, stemHeight,
        images: { question: img(`q${q.n}`), options: optionImages, solution: img(`s${q.n}`), keyStrip: img(`k${q.n}`), passage: set ? img(`passage-${set.id}`) : null },
        issues,
      };
    });
    draft.report = validateMockDraft(draft);
    return finish(draft, t0);
  } finally {
    doc.loadingTask.destroy();
  }
}

const scaleRect = (r) => ({ x0: r.x0 * MOCK_SCALE, y0: r.y0 * MOCK_SCALE, x1: r.x1 * MOCK_SCALE, y1: r.y1 * MOCK_SCALE });

function finish(draft, t0) {
  draft.timings.totalMs = Math.round(performance.now() - t0);
  if (!draft.report) draft.report = validateMockDraft(draft);
  return draft;
}
