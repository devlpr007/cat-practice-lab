// Turn a DPP PDF into a draft test (browser). Plain deterministic code — no AI, no network.
//
// Steps: open the PDF -> find and hide the faded-logo picture (only if the text under it is safe)
// -> draw each page and find its columns and text lines -> find the "Answer Key" and
// "Hints & Solutions" pages -> read the "Q<n>" labels (from the text layer if the PDF has one,
// otherwise by shape) -> split questions and solutions at the labels -> read the answer key ->
// find "(A)".."(D)" -> cut pictures -> check everything (validate.js).
// Anything structural that does not match is reported in draft.structuralErrors (the PDF is refused).
import { openPdf, pageSize, getImagePlacements, getTextItems, renderPage, canvasToGray, PDFJS_VERSION } from './pdf.js';
import { pageLayout, layoutWithoutDivider, dividerCandidates, commonDividerX, labelBoundaries, labelGlyphs, lineGlyphs } from './layout.js';
import { countInk, inkBox, INK } from './raster.js';
import * as shapes from './read-shapes.js';
import * as texts from './read-text.js';
import { readingOrder, splitAtLabels, splitWithSets, setProblems, numberingProblems, optionLayout } from './segment.js';
import { guessFromFileName, defaultTestName } from './filename.js';
import { validateDraft } from './validate.js';
import { renderCrops } from './crops.js';

export const PARSER_VERSION = '1.0.0';
export const ANALYSIS_SCALE = 3;

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameRect(a, b, tol = 1.5) {
  return Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.y0 - b.y0) <= tol && Math.abs(a.x1 - b.x1) <= tol && Math.abs(a.y1 - b.y1) <= tol;
}

/** Large pictures painted at the same place on at least half of the pages: watermark candidates. */
function repeatedLargeImages(pages) {
  const groups = [];
  for (const x of pages) {
    const pageArea = x.size.width * x.size.height;
    for (const im of x.images) {
      if ((im.x1 - im.x0) * (im.y1 - im.y0) < 0.04 * pageArea) continue;
      let g = groups.find((G) => sameRect(G.rect, im));
      if (!g) groups.push((g = { rect: im, pages: new Set() }));
      g.pages.add(x.page);
    }
  }
  const need = Math.max(2, Math.ceil(pages.length * 0.5));
  return groups.filter((g) => g.pages.size >= need).map((g) => g.rect);
}

/** Small pictures painted at the same left/right position with the same size on most pages. */
function repeatedSmallImages(pages) {
  const groups = [];
  for (const x of pages) {
    for (const im of x.images) {
      if (im.x1 - im.x0 > 80 || x.hide.some((h) => sameRect(h, im))) continue;
      let g = groups.find((G) => sameFurniture(G.im, im));
      if (!g) groups.push((g = { im, pages: new Set() }));
      g.pages.add(x.page);
    }
  }
  return groups.filter((g) => g.pages.size >= Math.max(2, Math.ceil(pages.length * 0.6))).map((g) => g.im);
}

function sameFurniture(a, b) {
  return a.pxWidth === b.pxWidth && a.pxHeight === b.pxHeight && Math.abs(a.x0 - b.x0) <= 1.5 && Math.abs(a.x1 - b.x1) <= 1.5;
}

const isQrLike = (im) => {
  const w = im.x1 - im.x0, h = im.y1 - im.y0;
  return w > 40 && w < 170 && h / w > 0.8 && h / w < 1.25;
};

const scaleRect = (r, s) => ({ x0: r.x0 * s, y0: r.y0 * s, x1: r.x1 * s, y1: r.y1 * s });
const intersects = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Parse a PDF. `input`: ArrayBuffer or Uint8Array. Options: fileName, onProgress({ step, done, total }),
 * scale (render scale, default 3 = 216 dpi), pages (subset of page numbers, for tests).
 * Returns a draft: { file, kind, header, questions, images, structure, structuralErrors, warnings, report, ... }.
 */
export async function parsePdf(input, { fileName = 'document.pdf', onProgress = () => {}, scale = ANALYSIS_SCALE, pages: subset = null } = {}) {
  const t0 = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const draft = {
    parserVersion: PARSER_VERSION,
    pdfjsVersion: PDFJS_VERSION,
    renderScale: scale,
    file: { name: fileName, size: bytes.byteLength, sha256: await sha256Hex(bytes), pages: 0 },
    kind: null,
    header: { subject: null, topic: null, dpp: null, name: '', source: null, image: null },
    questions: [],
    images: {},
    structure: {},
    structuralErrors: [],
    warnings: [],
    debug: { pages: [] },
    timings: {},
  };
  const refuse = (msg) => draft.structuralErrors.push(msg);
  const finish = (doc) => {
    if (doc) doc.loadingTask.destroy();
    draft.timings.totalMs = Math.round(performance.now() - t0);
    draft.report = validateDraft(draft);
    return draft;
  };

  onProgress({ step: 'Opening the PDF', done: 0, total: 1 });
  let doc;
  try {
    doc = await openPdf(bytes.slice());
  } catch (err) {
    refuse(err.message);
    return finish(null);
  }
  draft.file.pages = doc.numPages;
  const pageNums = subset || Array.from({ length: doc.numPages }, (_, i) => i + 1);

  // 1. pictures and text on every page
  const P = [];
  for (const p of pageNums) {
    const pdfPage = await doc.getPage(p);
    P.push({ page: p, pdfPage, size: pageSize(pdfPage), images: await getImagePlacements(pdfPage), text: await getTextItems(pdfPage) });
  }
  const pageOf = (n) => P.find((x) => x.page === n);
  const labelLike = P.reduce((s, x) => s + x.text.filter((t) => /^Q\s*\d{1,3}\b/.test(t.str.trim())).length, 0);
  draft.kind = labelLike >= 3 ? 'text' : 'shape';
  const useText = draft.kind === 'text';

  // 2. faded-logo picture: hide it only where the text underneath is really there
  const candidates = repeatedLargeImages(P);
  let hiddenPages = 0;
  for (const x of P) {
    x.hide = [];
    for (const r of candidates.filter((c) => x.images.some((im) => sameRect(im, c)))) {
      const normal = canvasToGray((await renderPage(x.pdfPage, 1)).canvas);
      const hidden = canvasToGray((await renderPage(x.pdfPage, 1, { hideRects: [r] })).canvas);
      const a = countInk(normal, r, 160);
      const b = countInk(hidden, r, 160);
      if (b >= 0.6 * a) x.hide.push(r);
      else draft.warnings.push(`Page ${x.page}: a large picture covers part of the page and could not be safely removed, so it stays visible in the pictures.`);
    }
    if (x.hide.length) hiddenPages++;
  }
  draft.structure.watermark = hiddenPages ? `yes (${hiddenPages} of ${P.length} pages)` : 'no faded logo found';

  // 3. draw each page and find its layout
  // Small pictures repeated at the same left/right position on most pages (the footer's icon) mark
  // where the footer starts; on the last page of a section the footer moves up under the text.
  const furniture = repeatedSmallImages(P);
  for (let i = 0; i < P.length; i++) {
    const x = P[i];
    onProgress({ step: `Reading page ${i + 1} of ${P.length}`, done: i, total: P.length });
    const { canvas } = await renderPage(x.pdfPage, scale, { hideRects: x.hide });
    x.img = canvasToGray(canvas);
    canvas.width = canvas.height = 0;
    const footer = x.images.filter((im) => furniture.some((f) => sameFurniture(f, im)) && im.y0 > x.size.height * 0.15);
    x.footerTop = footer.length ? Math.min(...footer.map((im) => im.y0)) * scale - 3 * scale : null;
    x.candidates = dividerCandidates(x.img, scale);
    await tick();
  }
  const dividerX = commonDividerX(P.map((x) => x.candidates), scale);
  // text-layer PDFs: boxes of right-column words that start just right of the column line (labels
  // such as "Q3."), which a left-column table running over the line must not swallow
  const keepBoxes = (x) => {
    if (!useText || dividerX == null) return [];
    const lineX = dividerX / scale;
    return x.text.filter((it) => it.x0 > lineX + 2 && it.x0 < lineX + 25 && /^Q\s*\d/.test(String(it.str).trim()))
      .map((it) => ({ x0: Math.floor((it.x0 - 0.5) * scale), x1: Math.ceil((it.x1 + 0.5) * scale), y0: Math.floor((it.yTop - 0.5) * scale), y1: Math.ceil((it.yBottom + 0.5) * scale) }));
  };
  for (const x of P) x.layout = pageLayout(x.img, scale, { bottomLimit: x.footerTop, dividerX, keep: keepBoxes(x) });
  // pages without a line between the columns use the line position of the other pages
  const withLine = P.filter((x) => x.layout.divider);
  if (!withLine.length) {
    refuse('This PDF does not have the expected two-column layout (no line between the columns on any page).');
    return finish(doc);
  }
  const median = (a) => a.slice().sort((u, v) => u - v)[Math.floor(a.length / 2)];
  const ref = {
    x0: median(withLine.map((x) => x.layout.divider.x0)),
    x1: median(withLine.map((x) => x.layout.divider.x1)),
    top: median(withLine.map((x) => x.layout.divider.y0)),
    bottom: median(withLine.map((x) => x.layout.divider.y1)),
  };
  for (const x of P) {
    if (x.layout.divider) {
      x.title = useText ? texts.findSectionTitleText(x.text, x.layout.top, scale) : shapes.findSectionTitle(x.img, x.layout.top);
    } else if (x === P[0]) {
      refuse('The first page does not have the expected two-column layout (no line between the columns).');
    } else {
      x.layout = layoutWithoutDivider(x.img, scale, ref, x.footerTop);
      if (x.layout.crossing) refuse(`Page ${x.page} has something spreading across both columns, which is not the expected layout.`);
      x.title = null;
      for (const box of x.layout.heading) {
        const t = useText ? texts.findSectionTitleInBox(x.text, box, scale) : shapes.readHeading(x.img, box);
        const word = useText ? t && t.title : t.clear ? t.word : null;
        if (word === 'Answer Key' || word === 'Hints & Solutions') x.title = { title: word, box };
      }
    }
    draft.debug.pages.push({ page: x.page, title: x.title?.title || null, overflowBoxes: (x.layout.overflow || []).length, headingPt: (x.layout.heading || []).map((b) => [b.y0, b.y1].map((v) => Math.round(v / scale))), topPt: Math.round(x.layout.top / scale), divider: x.layout.synthetic ? 'from other pages' : +((x.layout.divider.x0 + x.layout.divider.x1) / 2 / scale).toFixed(1), hidden: x.hide.length, colStartsPt: x.layout.columns.map((c) => c.bands.length ? +(Math.min(...c.bands.map((b) => b.x0)) / scale).toFixed(1) : null), footerTopPt: x.footerTop && Math.round(x.footerTop / scale) });
  }

  // 4. sections
  onProgress({ step: 'Finding questions, answers and solutions', done: 0, total: 1 });
  const keyIdx = P.findIndex((x) => x.title?.title === 'Answer Key');
  const solIdx = P.findIndex((x) => x.title?.title === 'Hints & Solutions');
  if (P.filter((x) => x.title?.title === 'Answer Key').length > 1) refuse('This PDF has more than one "Answer Key" page heading.');
  if (keyIdx < 0) refuse('No "Answer Key" page was found in this PDF.');
  if (solIdx < 0) refuse('No "Hints & Solutions" page was found in this PDF.');
  if (keyIdx === 0) refuse('The "Answer Key" is on the first page; no question pages were found before it.');
  if (keyIdx >= 0 && solIdx >= 0 && solIdx <= keyIdx) refuse('The "Hints & Solutions" pages come before the "Answer Key" page, which is not the expected order.');
  if (draft.structuralErrors.length) return finish(doc);
  const qPages = P.slice(0, keyIdx);
  const kPages = P.slice(keyIdx, solIdx);
  const sPages = P.slice(solIdx);

  // 5. labels ("Q<n>" at the left edge of a column)
  const bounds = labelBoundaries(P.map((x) => x.layout));
  if (!bounds[0] || !bounds[1]) {
    refuse('Could not tell the question labels ("Q1", "Q2", …) apart from the question text.');
    return finish(doc);
  }
  draft.debug.boundariesPt = bounds.map((b) => ({ labelX: +(b.labelX / scale).toFixed(1), textX: +(b.textX / scale).toFixed(1) }));
  // Text-layer PDFs: a "Q12." word at a column's label margin starts a label line, even when the
  // picture joins that line to something above it (a left-column table printed over the right
  // column, with its lines running through). Split the band at the top of that word.
  if (useText) {
    for (const x of P) {
      for (const col of x.layout.columns) {
        const b = bounds[col.index];
        const starts = x.text.filter((it) => /^Q\s*\d{1,3}\b/.test(String(it.str).trim()) && it.x0 * scale >= b.labelX - 3 * scale && it.x0 * scale < b.boundary
          && ((it.x0 + it.x1) / 2) * scale >= col.x0 && ((it.x0 + it.x1) / 2) * scale < col.x1);
        if (!starts.length) continue;
        const out = [];
        for (const band of col.bands) {
          const cuts = starts.map((it) => Math.floor(it.yTop * scale - 1 * scale)).filter((y) => y > band.y0 + 2 * scale && y < band.y1 - 2 * scale).sort((m, n) => m - n);
          let y0 = band.y0;
          for (const y of cuts) { out.push({ ...band, y0, y1: y }); y0 = y; }
          out.push({ ...band, y0 });
        }
        col.bands = out;
      }
    }
  }
  for (const x of P) {
    const onSolutionPage = solIdx >= 0 && P.indexOf(x) >= solIdx;
    for (const col of x.layout.columns) {
      for (const band of col.bands) {
        if (band.x0 >= bounds[col.index].boundary) {
          // PDFs without text: a line that STARTS with the "Text Solution:" heading (at the text
          // indent) is a solution whose label was printed over or wiped with a table running across
          // the column line. It is marked as a solution start without a number (filled in below).
          const textX = bounds[col.index].textX;
          if (!useText && onSolutionPage && band.x0 <= textX + 3 * scale && band.y1 - band.y0 < 14 * scale
            && shapes.isTextSolutionLine(x.img, col, band, { x1: band.x0 - 3 * scale }, scale)) {
            band.label = { n: null, text: '?', clear: false, box: null, glyphs: [], unreadable: true };
          }
          continue;
        }
        // Only something that reads "Q<n>" is a label; anything else in the margin (a diagram, a
        // wide formula) stays ordinary content. A real label that cannot be read is still caught,
        // because the numbering check below then finds a gap and refuses the PDF.
        if (useText) {
          const t = texts.readLabelText(x.text, col, band, bounds[col.index].boundary, scale);
          if (t.clear) {
            // label box: the glyphs on the image, joined with where the text layer says "Q12" is
            let box = labelGlyphs(x.img, col, band, 4 * scale).box;
            if (t.textBox) {
              const tb = { x0: t.textBox.x0, x1: t.textBox.x1, y0: Math.max(band.y0, t.textBox.y0), y1: Math.min(band.y1, t.textBox.y1) };
              box = box ? { x0: Math.min(box.x0, tb.x0), x1: Math.max(box.x1, tb.x1), y0: Math.min(box.y0, tb.y0), y1: Math.max(box.y1, tb.y1) } : tb;
            }
            band.label = { ...t, box };
          }
        } else {
          const l = shapes.readLabel(x.img, col, band, scale);
          // On question pages only a line that clearly reads "Q<n>" is a label: a margin word of a
          // passage ("On", "One") can look like a bold Q with unclear digits. A real label that is
          // unreadable still refuses the PDF, through the numbering gap it leaves. Answer-key and
          // solution pages ("Q12 Text Solution:") keep the looser rule they were tested with.
          const onQuestionPage = keyIdx >= 0 && P.indexOf(x) < keyIdx;
          if (l.clear || (!onQuestionPage && l.glyphs[0] && l.glyphs[0].clear && l.glyphs[0].char === 'Q')) band.label = l;
          // A solution label that something is printed over (a left-column table running across the
          // line) cannot be read at all; the line still says "Text Solution:" in the text column.
          // It is marked as a solution start without a number (filled in below, or refused).
          else if (solIdx >= 0 && P.indexOf(x) >= solIdx && shapes.isTextSolutionLine(x.img, col, band, { x1: bounds[col.index].boundary - 3 * scale }, scale)) {
            band.label = { n: null, text: '?', clear: false, box: l.box, glyphs: [], unreadable: true };
          }
        }
      }
    }
  }

  // A label line glued under something else (e.g. the previous solution's QR code, with no blank
  // row between them) is split at the top of the label, so that "something" stays with the item before.
  for (const x of P) {
    for (const col of x.layout.columns) {
      const out = [];
      for (const band of col.bands) {
        const top = band.label && band.label.box ? band.label.box.y0 - 2 * scale : null;
        if (top !== null && top > band.y0 + 2 * scale) {
          out.push({ y0: band.y0, y1: Math.floor(top), x0: band.x0, x1: band.x1 });
          out.push({ ...band, y0: Math.floor(top) });
        } else out.push(band);
      }
      col.bands = out;
    }
  }

  // "Directions (1-5) …" lines start passage sets (VARC / LRDI); read from the text layer
  if (useText) {
    for (const x of qPages) {
      for (const col of x.layout.columns) {
        for (const band of col.bands) {
          // headings start at the column's left edge, not at the indented question text
          if (band.label || band.x0 >= bounds[col.index].boundary) continue;
          const d = texts.readDirectionsText(x.text, col, band, scale);
          if (d) band.directions = d;
        }
      }
    }
  } else {
    // No text layer: a block at the column's label margin that is not a "Q<n>" label is passage
    // text ("Directions (a-b) …" and the passage; question text is indented). Only when the DPP
    // starts with such a block (RC / LRDI sets) — a Quant DPP starts with Q1. The range cannot be
    // read, so each passage goes to the questions after it up to the next passage; the warning
    // sends the PDF to the review page, where the user checks the sets.
    const marginBands = qPages.flatMap((x) => x.layout.columns.flatMap((col) => col.bands.filter((b) => b.x0 < bounds[col.index].boundary)));
    if (marginBands.length && !marginBands[0].label) {
      for (const b of marginBands) if (!b.label) b.directions = { from: null, to: null, implied: true };
      draft.warnings.push('This PDF has no text layer, so the "Directions (a–b)" ranges could not be read. Each passage was given to the questions that follow it, up to the next passage: please check the passage sets (Q1–Q5, …) on this page.');
    }
  }

  // 6. split into questions, answer-key lines and solutions; check numbering and counts
  const seg = (pages) => readingOrder(pages.map((x) => ({ page: x.page, columns: x.layout.columns })));
  const qSeg = splitWithSets(seg(qPages));
  for (const m of setProblems(qSeg.sets)) refuse(m);
  const sSeg = splitAtLabels(seg(sPages));
  // A solution whose number could not be read gets the number missing between its neighbours,
  // only when exactly one number is missing there ("Q12", ?, "Q14" -> Q13); the review page says so.
  sSeg.items.forEach((it, i) => {
    if (it.label.n != null) return;
    const prev = i === 0 ? 0 : sSeg.items[i - 1].label.n;
    const next = sSeg.items[i + 1]?.label.n;
    if (prev == null || (next != null && next !== prev + 2)) return;
    if (next == null && i !== sSeg.items.length - 1) return;
    it.label = { ...it.label, n: prev + 1, text: `Q${prev + 1}`, inferred: true };
    draft.warnings.push(`Solution of Q${prev + 1}: its label could not be read (something is printed over it in the PDF), so it was placed between Q${prev} and ${next != null ? `Q${next}` : 'the end'} by its position. Please check its solution picture.`);
  });
  const kEntries = seg(kPages);
  const kItems = kEntries.filter((e) => e.band.label).map((e) => ({ label: e.band.label, entries: [e] }));
  const kOther = kEntries.filter((e) => !e.band.label);
  if (qSeg.orphans.length) refuse(`There is text before the first question label on page ${qSeg.orphans[0].page} that does not belong to any question.`);
  if (sSeg.orphans.length) refuse(`There is text before the first solution label on page ${sSeg.orphans[0].page} that does not belong to any solution.`);
  if (kOther.length) refuse(`The Answer Key page has ${kOther.length} line(s) that are not "Q<n> answer" entries.`);
  const qProblems = numberingProblems(qSeg.items, 'Questions');
  const kProblems = numberingProblems(kItems, 'Answer key');
  const sProblems = numberingProblems(sSeg.items, 'Solutions');
  for (const m of [...qProblems, ...kProblems, ...sProblems].slice(0, 6)) refuse(m);
  const N = qSeg.items.length;
  if (!N) refuse('No questions ("Q1", "Q2", …) were found.');
  if (kItems.length !== N) refuse(`Found ${N} questions but ${kItems.length} answer-key entries.`);
  if (sSeg.items.length !== N) refuse(`Found ${N} questions but ${sSeg.items.length} solutions.`);
  draft.structure = {
    ...draft.structure,
    questionNumbering: qProblems, keyNumbering: kProblems, solutionNumbering: sProblems,
    keyCount: kItems.length, solutionCount: sSeg.items.length, qrProblems: [],
    sets: qSeg.sets.map((st) => ({ from: st.items[0]?.label.n ?? null, to: st.items[st.items.length - 1]?.label.n ?? null })),
  };
  if (draft.structuralErrors.length) return finish(doc);

  // 7. answer key values
  const key = {};
  for (const it of kItems) {
    const e = it.entries[0];
    const x = pageOf(e.page);
    const col = x.layout.columns[e.col];
    let v;
    if (useText) {
      const t = texts.readLabelText(x.text, col, e.band, bounds[col.index].boundary, scale);
      v = texts.parseKeyValueText(t.rest);
      v.box = inkBox(x.img, { x0: it.label.box.x1 + 3 * scale, x1: col.x1, y0: e.band.y0, y1: e.band.y1 }, INK);
    } else {
      v = shapes.readKeyValue(x.img, col, e.band, it.label.box, scale);
    }
    // what the shape reader saw on an unclear key line (for improving the reader; no pictures)
    if (!v.clear) (draft.debug.unclearKeys ||= []).push({ n: it.label.n, glyphs: (v.glyphs || []).map((g) => ({ char: g.char, score: g.score, second: g.second, secondScore: g.secondScore, clear: g.clear })) });
    key[it.label.n] = { ...v, entry: e };
  }

  // 8. solutions: stop at "Video Solution:", keep QR codes out
  const solutions = sSeg.items.map((item) => {
    let cut = -1;
    let cutY = null;
    item.entries.forEach((e, k) => {
      if (cut >= 0) return;
      const x = pageOf(e.page);
      const col = x.layout.columns[e.col];
      if (useText) {
        const top = texts.videoSolutionTop(x.text, col, e.band, scale);
        if (top === null || (k === 0 && top <= e.band.y0 + 2 * scale)) return;
        cut = k;
        if (top > e.band.y0 + 2 * scale) cutY = top; // heading glued under other content
      } else if (k > 0 && shapes.isVideoSolutionLine(x.img, col, e.band, bounds[col.index].boundary)) {
        cut = k;
      }
    });
    let solEntries = cut >= 0 ? item.entries.slice(0, cut) : item.entries;
    if (cutY !== null) {
      const e = item.entries[cut];
      solEntries = [...solEntries, { ...e, band: { ...e.band, y1: cutY } }];
    }
    return { label: item.label, item, cut, solEntries, issues: [] };
  });
  // QR codes: learn their exact pixel size from the pictures right after "Video Solution:" lines,
  // so that diagrams of a similar shape inside solutions are not mistaken for QR codes
  const imagesNear = (e) => (pageOf(e.page).images || []).filter((im) => !pageOf(e.page).hide.some((h) => sameRect(h, im))
    && intersects(scaleRect(im, scale), { x0: e.colRect.x0, x1: e.colRect.x1, y0: e.band.y0, y1: e.band.y1 }));
  const qrSizes = new Set();
  for (const s of solutions) {
    if (s.cut < 0) continue;
    for (const e of s.item.entries.slice(s.cut, s.cut + 2)) for (const im of imagesNear(e)) if (isQrLike(im) && im.pxWidth) qrSizes.add(`${im.pxWidth}x${im.pxHeight}`);
  }
  const isQr = (im) => isQrLike(im) && (qrSizes.size ? qrSizes.has(`${im.pxWidth}x${im.pxHeight}`) : true);
  draft.debug.qrSizes = [...qrSizes];
  const qrByPage = new Map(sPages.map((x) => [x.page, x.images.filter((im) => isQr(im) && !x.hide.some((h) => sameRect(h, im)))]));
  for (const s of solutions) {
    if (s.cut < 0) {
      s.issues.push({ level: 'warning', text: 'no "Video Solution:" heading was found after this solution, so its picture runs up to the next solution — please check it.' });
      continue;
    }
    // lines after "Video Solution:" should only be the QR code
    const leftOut = s.item.entries.slice(s.cut + 1).filter((e) => {
      const qrs = qrByPage.get(e.page) || [];
      return !qrs.some((q) => intersects(scaleRect(q, scale), { x0: e.colRect.x0, x1: e.colRect.x1, y0: e.band.y0, y1: e.band.y1 }));
    });
    if (leftOut.length) s.issues.push({ level: 'warning', text: `${leftOut.length} line(s) after "Video Solution:" are not a QR code and were left out of the solution picture.` });
  }

  // 9. option markers "(A)".."(D)" in each question
  const findMarkers = (x, col, band, startX) => {
    if (!useText) return shapes.findOptionMarkers(x.img, col, band, startX, scale);
    const approx = texts.findOptionMarkersText(x.text, col, band, scale).filter((m) => m.x1 > startX);
    const lg = lineGlyphs(x.img, { x0: startX, x1: col.x1, y0: band.y0, y1: band.y1 }).glyphs;
    return approx.map((m) => {
      const near = lg.filter((g) => Math.abs(g.x0 - m.x0) < 5 * scale).sort((a, b) => Math.abs(a.x0 - m.x0) - Math.abs(b.x0 - m.x0))[0];
      const end = lg.filter((g) => Math.abs(g.x1 - m.x1) < 5 * scale).sort((a, b) => Math.abs(a.x1 - m.x1) - Math.abs(b.x1 - m.x1))[0];
      return near && end && end.x1 > near.x0
        ? { ...m, x0: near.x0, x1: end.x1, y0: Math.min(near.y0, end.y0), y1: Math.max(near.y1, end.y1), approx: false }
        : m;
    });
  };
  const questionsRaw = qSeg.items.map((item) => {
    const markers = [];
    item.entries.forEach((e, k) => {
      const x = pageOf(e.page);
      const col = x.layout.columns[e.col];
      const startX = k === 0 && item.label.box ? item.label.box.x1 + 2 * scale : bounds[col.index].boundary;
      for (const m of findMarkers(x, col, e.band, startX)) markers.push({ ...m, entryIndex: k });
    });
    return { item, markers, options: optionLayout(item, markers) };
  });

  // 10. crop specs
  const specs = [];
  const overlapPages = new Set();
  // Full-width pieces start a little left of the column's label position, so pieces from the
  // left and right columns line up when they are stacked into one picture.
  const colLeft = (e) => Math.max(e.colRect.x0, bounds[e.col].labelX - 2 * scale);
  const partsFrom = (entries, { x0 = null, x1 = null, whiteouts = [] } = {}) => {
    const parts = [];
    entries.forEach((e, k) => {
      const last = parts[parts.length - 1];
      // same column and no large blank gap: extend the piece (big gaps start a new piece, so they
      // are closed up when the pieces are stacked)
      if (last && last.page === e.page && last.col === e.col && e.band.y0 - last.rect.y1 <= 30 * scale) {
        last.rect.y1 = e.band.y1;
        last.entryIdx.push(k);
      } else {
        parts.push({
          page: e.page, col: e.col, entryIdx: [k],
          rect: { x0: x0 ?? colLeft(e), x1: x1 ?? e.colRect.x1, y0: e.band.y0, y1: e.band.y1 },
          whiteouts: [],
        });
      }
    });
    for (const p of parts) {
      p.whiteouts = whiteouts.filter((w) => w.page === p.page).map((w) => w.rect);
      // left-column content that sticks out across the column line: widen the piece to include it
      const layout = pageOf(p.page).layout;
      const overlaps = (layout.overflow || []).filter((o) => o.y0 < p.rect.y1 && o.y1 > p.rect.y0);
      if (overlaps.length) p.overflow = true;
      // in right-column pieces, the left column's overhanging part is blanked out
      if (p.col === 1) for (const o of overlaps) p.whiteouts.push(o);
      if (p.col === 0 && x1 === null && overlaps.length) {
        const before = p.rect.x1;
        for (const o of overlaps) p.rect.x1 = Math.max(p.rect.x1, o.x1 + 2 * scale);
        // the widened strip must not contain right-column content (other than a "Q<n>" label):
        // if it does, the PDF prints the two columns on top of each other there
        const strip = { x0: Math.max(before, layout.divider.x1 + scale), x1: p.rect.x1, y0: p.rect.y0, y1: p.rect.y1 };
        let ink = countInk(pageOf(p.page).img, strip, INK);
        for (const b of layout.columns[1].bands) {
          if (b.label && b.label.box) ink -= countInk(pageOf(p.page).img, {
            x0: Math.max(strip.x0, b.label.box.x0), x1: Math.min(strip.x1, b.label.box.x1),
            y0: Math.max(strip.y0, b.label.box.y0), y1: Math.min(strip.y1, b.label.box.y1) }, INK);
        }
        if (ink > 30) overlapPages.add(p.page);
        // blank out right-column labels that the widened piece now reaches
        for (const b of layout.columns[1].bands) {
          if (b.label && b.label.box && b.label.box.x0 < p.rect.x1 && b.y0 < p.rect.y1 && b.y1 > p.rect.y0) p.whiteouts.push(b.label.box);
        }
      }
    }
    return parts;
  };
  const labelWhiteout = (item) => (item.label.box ? [{ page: item.entries[0].page, rect: item.label.box }] : []);
  questionsRaw.forEach((q, i) => {
    const n = i + 1;
    const wo = labelWhiteout(q.item);
    const full = { id: `q${n}`, parts: partsFrom(q.item.entries, { whiteouts: wo }) };
    if (q.options) {
      // where the first option row starts inside the full question picture = end of the stem
      const firstRow = q.item.entries[q.options.stem.length];
      const partIndex = full.parts.findIndex((p) => p.entryIdx.includes(q.options.stem.length));
      full.marks = [{ partIndex, y: firstRow.band.y0 }];
    }
    specs.push(full);
    if (i === 0) {
      // each passage set's passage / data (text, chart, table) as one picture
      qSeg.sets.forEach((st, k) => specs.push({ id: `passage${k + 1}`, parts: partsFrom(st.entries) }));
    }
    if (q.options) {
      for (const letter of ['A', 'B', 'C', 'D']) {
        const o = q.options.options[letter];
        const mw = o.whiteout;
        const markerWo = [{ page: q.item.entries[mw.entryIndex].page, rect: mw }];
        const parts = [];
        for (const part of o.parts) {
          const e = q.item.entries[part.entryIndex];
          parts.push(...partsFrom([e], { x0: part.x0 ?? colLeft(e), x1: part.x1 ?? e.colRect.x1, whiteouts: part.entryIndex === mw.entryIndex ? markerWo : [] }));
        }
        // merge consecutive lines of the same column into one part
        const merged = [];
        for (const p of parts) {
          const last = merged[merged.length - 1];
          if (last && last.page === p.page && last.col === p.col && last.rect.x0 === p.rect.x0 && last.rect.x1 === p.rect.x1) {
            last.rect.y1 = p.rect.y1;
            last.whiteouts.push(...p.whiteouts);
          } else merged.push(p);
        }
        specs.push({ id: `q${n}-opt${letter}`, parts: merged });
      }
    }
  });
  const overflowNote = (parts) => parts.some((p) => p.overflow);
  questionsRaw.forEach((q, i) => {
    const full = specs.find((sp) => sp.id === `q${i + 1}`);
    if (full && overflowNote(full.parts)) q.overflowWarning = true;
  });
  solutions.forEach((s, i) => {
    const n = i + 1;
    s.parts = partsFrom(s.solEntries, { whiteouts: labelWhiteout(s.item) });
    if (overflowNote(s.parts)) s.issues.push({ level: 'warning', text: 'on this page a table or formula from the left column runs past the line between the columns; please check that the solution picture is complete and tidy.' });
    specs.push({ id: `s${n}`, parts: s.parts });
    // QR codes must never be inside a solution picture
    for (const part of s.parts) {
      for (const q of qrByPage.get(part.page) || []) {
        if (intersects(scaleRect(q, scale), part.rect)) {
          draft.structure.qrProblems.push(`Q${n}`);
          (draft.debug.qr ||= []).push({
            q: n, image: [q.x0, q.y0, q.x1, q.y1].map((v) => Math.round(v)), page: part.page,
            lines: s.item.entries.map((e) => `p${e.page}c${e.col} ${Math.round(e.band.y0 / scale)}-${Math.round(e.band.y1 / scale)} `
              + (useText ? texts.lineText(texts.itemsInBand(pageOf(e.page).text, e.colRect, e.band, scale)).slice(0, 50) : '')),
          });
        }
      }
    }
  });
  // Overlap on a question page: refuse (the question itself could be wrong). Overlap on a solutions
  // page: keep the picture as the PDF prints it, but flag those solutions for the user to check.
  const solutionPageSet = new Set(sPages.map((x) => x.page));
  for (const pg of overlapPages) {
    if (!solutionPageSet.has(pg)) {
      refuse(`On page ${pg}, a table or formula from the left column is printed on top of the right column's text (this is how the PDF itself is printed), so the question pictures there would mix two questions.`);
    }
  }
  solutions.forEach((s, i) => {
    if (s.parts.some((p) => overlapPages.has(p.page))) {
      s.issues.push({ level: 'warning', text: `on page ${s.parts.find((p) => overlapPages.has(p.page)).page} the PDF prints a table on top of other text; this solution picture shows it as printed and may include part of another solution — please check it.` });
      draft.structure.qrProblems = draft.structure.qrProblems.filter((x) => x !== `Q${i + 1}`);
    }
  });
  for (const n of draft.structure.qrProblems) refuse(`${n}: a QR code would end up inside the solution picture.`);
  for (const it of kItems) {
    const e = it.entries[0];
    const v = key[it.label.n];
    const right = Math.max(it.label.box ? it.label.box.x1 : e.colRect.x0, v.box ? v.box.x1 : 0) + 30 * scale;
    specs.push({ id: `k${it.label.n}`, parts: [{ page: e.page, col: e.col, rect: { x0: e.colRect.x0, x1: Math.min(e.colRect.x1, right), y0: e.band.y0, y1: e.band.y1 }, whiteouts: [] }] });
  }
  // page-1 heading (title, subject, topic) without the lines repeated on every page (date line, badge)
  const first = P[0];
  const aboveBoxes = (x) => {
    const boxes = [];
    let start = -1;
    for (let y = 0; y <= x.layout.top; y++) {
      const b = y < x.layout.top ? inkBox(x.img, { x0: 0, x1: x.img.width, y0: y, y1: y + 1 }, INK) : null;
      if (b && start < 0) start = y;
      if (!b && start >= 0) { boxes.push(inkBox(x.img, { x0: 0, x1: x.img.width, y0: start, y1: y }, INK)); start = -1; }
    }
    return boxes;
  };
  const others = P.slice(1, 4).map(aboveBoxes);
  const headerBoxes = aboveBoxes(first).filter((b) => !others.some((list) => list.some((o) => sameRect(o, b, 3 * scale))));
  if (headerBoxes.length) {
    const hb = { x0: Math.min(...headerBoxes.map((b) => b.x0)), x1: Math.max(...headerBoxes.map((b) => b.x1)), y0: Math.min(...headerBoxes.map((b) => b.y0)), y1: Math.max(...headerBoxes.map((b) => b.y1)) };
    specs.push({ id: 'header', parts: [{ page: first.page, rect: hb, whiteouts: [] }] });
  }
  if (draft.structuralErrors.length) return finish(doc);

  // 11. cut the pictures
  const tCrop = performance.now();
  const crops = await renderCrops(doc, specs, scale, new Map(P.map((x) => [x.page, x.hide])), (done, total) => {
    onProgress({ step: `Cutting out pictures (page ${done} of ${total})`, done, total });
  });
  draft.timings.cropsMs = Math.round(performance.now() - tCrop);
  const img = (id) => {
    const c = crops.get(id);
    if (!c || c.empty || !c.blob) return null;
    draft.images[id] = { blob: c.blob, width: c.width, height: c.height };
    return id;
  };

  // 12. assemble the draft
  draft.questions = questionsRaw.map((q, i) => {
    const n = i + 1;
    const k = key[n];
    const issues = [...solutions[i].issues];
    if (q.overflowWarning) issues.push({ level: 'warning', text: 'on this page a table or formula from the left column runs past the line between the columns; please check that the question picture is complete and tidy.' });
    let optionsMode = 'none';
    let optionImages = null;
    let stemHeight = null;
    if (q.options) {
      optionImages = {};
      for (const L of ['A', 'B', 'C', 'D']) optionImages[L] = img(`q${n}-opt${L}`);
      stemHeight = crops.get(`q${n}`)?.marks?.[0] ?? null;
      optionsMode = Object.values(optionImages).every(Boolean) && stemHeight > 20 ? 'separate' : 'fallback';
      if (optionsMode === 'fallback') { optionImages = null; stemHeight = null; }
    } else if (q.markers.length) {
      optionsMode = 'fallback';
    }
    const detected = k && k.clear ? k.value : null;
    if (k && !k.clear) issues.push({ level: 'warning', text: 'the answer key entry could not be read clearly — please type it from the picture.' });
    if (k && k.kind === 'letter' && optionsMode === 'none') optionsMode = 'fallback';
    return {
      n,
      setId: q.item.setIndex != null ? `set-${q.item.setIndex + 1}` : null,
      answer: { detected, value: detected, edited: false, readClearly: !!(k && k.clear) },
      markersFound: q.markers.length,
      optionsMode,
      stemHeight,
      images: {
        question: img(`q${n}`),
        options: optionImages,
        solution: img(`s${n}`),
        keyStrip: img(`k${n}`),
        passage: q.item.setIndex != null ? img(`passage${q.item.setIndex + 1}`) : null,
      },
      issues,
    };
  });
  draft.header.image = img('header');

  // 13. subject / topic / DPP suggestions (always confirmed by the user)
  const fromName = guessFromFileName(fileName);
  let fromText = { subject: null, topic: null, dpp: null };
  if (useText) fromText = texts.headerFromText(first.text, first.layout.top, scale);
  draft.header.subject = fromText.subject || fromName.subject;
  draft.header.topic = fromText.topic || fromName.topic;
  draft.header.dpp = fromText.dpp || fromName.dpp;
  draft.header.source = fromText.subject || fromText.topic ? 'pdf text' : (fromName.subject || fromName.topic ? 'file name' : null);
  draft.header.name = defaultTestName({ topic: draft.header.topic, dpp: draft.header.dpp, base: fromName.base });
  onProgress({ step: 'Checking', done: 1, total: 1 });
  return finish(doc);
}
