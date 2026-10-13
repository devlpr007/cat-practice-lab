// Structure of a CAT mock PDF in the one supported format (user, 2026-10-13; sample: "CAT 2025
// Slot 1 Question Paper.pdf"). Pure code, unit-testable in Node: it works on text items and image
// placements already read from the PDF and returns where everything is. Nothing is guessed: any
// mismatch is reported in `problems` and the PDF is refused.
//
// Layout facts (from the sample): single column, content x ≈ 46..550 pt; section headings "VARC",
// "LRDI", "Quant" in a big font on the question pages; questions "n." at x ≈ 47 numbered 1..N in
// reading order (VARC, then LRDI, then Quant); options as single letters A–D at x ≈ 62; passage sets
// start with "Instructions [a - b ]"; an "Answers" page with "n. value" pairs per section; then an
// "Explanations" heading followed by "n. value" + working for every question. Noise: ad banners and
// video thumbnails (raster images repeated through the PDF) with a "VIDEO SOLUTION" label, a faint
// diagonal watermark (page-sized images), page numbers "n/N" at the foot.

export const SECTION_NAMES = [
  { key: 'varc', names: ['VARC'], subject: 'VARC', display: 'VARC' },
  { key: 'dilr', names: ['LRDI', 'DILR'], subject: 'LRDI', display: 'DILR' },
  { key: 'qa', names: ['QUANT', 'QA', 'QUANTITATIVE APTITUDE'], subject: 'Quantitative Aptitude', display: 'QA' },
];
export const CONTENT = { x0: 42, x1: 554, top: 34, bottom: 808 };
const LABEL_X = [43, 53];
const OPTION_X = [56, 70];
const LABEL_RE = /^(\d{1,3})\.( |\s|$)/;
const MIN_QUESTIONS = 10;
const INSTR_RE = /^Instructions?\s*\[\s*(\d+)\s*-\s*(\d+)\s*\]/i;

const norm = (s) => String(s || '').replace(/ /g, ' ').trim();
const upper = (s) => norm(s).toUpperCase();

/** Items of one page in reading order (top to bottom, then left to right). */
export function readingOrder(items) {
  return items.slice().sort((a, b) => (Math.round(a.yTop) - Math.round(b.yTop)) || (a.x0 - b.x0));
}

function headingOf(it) {
  if (it.fontSize < 10) return null;
  const t = upper(it.str);
  if (t === 'ANSWERS' || t === 'ANSWER KEY') return { type: 'answers' };
  if (t === 'EXPLANATIONS' || t === 'SOLUTIONS') return { type: 'explanations' };
  const sec = SECTION_NAMES.find((s) => s.names.includes(t));
  if (sec) return { type: 'section', key: sec.key };
  return null;
}

/** Noise pictures: ad banners (wide and short) and video thumbnails (a "VIDEO SOLUTION" label just below). */
export function noiseImages(pages) {
  // a banner is a wide, short picture that appears more than once in the PDF (same pixel size)
  const countBySize = new Map();
  for (const p of pages) for (const im of p.images) {
    const k = `${im.pxWidth}x${im.pxHeight}`;
    countBySize.set(k, (countBySize.get(k) || 0) + 1);
  }
  const out = new Map(); // page -> [{ rect, kind }]
  for (const p of pages) {
    const labels = p.items.filter((it) => /VIDEO\s+SOLUTION/i.test(it.str));
    for (const im of p.images) {
      const w = im.x1 - im.x0; const h = im.y1 - im.y0;
      if (w < 30 || h < 10) continue;
      const repeated = (countBySize.get(`${im.pxWidth}x${im.pxHeight}`) || 0) >= 2;
      const banner = repeated && w / h >= 3.5 && w >= 200;
      const label = labels.find((l) => l.yTop >= im.y1 - 6 && l.yTop <= im.y1 + 40 && l.x0 < im.x1 && l.x1 > im.x0);
      const video = !!label && w >= 120;
      if (banner || video) {
        if (!out.has(p.page)) out.set(p.page, []);
        const rect = { x0: im.x0 - 2, y0: im.y0 - 2, x1: video ? Math.max(im.x1, label.x1 + 14) : im.x1 + 2, y1: video ? Math.max(im.y1, label.yBottom) + 8 : im.y1 + 2 };
        out.get(p.page).push({ rect, kind: video ? 'video' : 'banner', image: im });
      }
    }
    // a "VIDEO SOLUTION" line whose thumbnail was not recognised still has to go
    for (const l of labels) {
      const covered = (out.get(p.page) || []).some((n) => l.yTop >= n.rect.y0 && l.yBottom <= n.rect.y1);
      if (!covered) {
        if (!out.has(p.page)) out.set(p.page, []);
        out.get(p.page).push({ rect: { x0: CONTENT.x0, y0: l.yTop - 8, x1: l.x1 + 14, y1: l.yBottom + 8 }, kind: 'video-label' });
      }
    }
  }
  return out;
}

/**
 * pages: [{ page (1-based), size: { width, height }, items: [{ str, x0, x1, yTop, yBottom, fontSize, fontName }],
 *          images: [{ x0, y0, x1, y1, pxWidth, pxHeight }] }]
 * Returns { sections, questions, sets, key, solutions, answersAt, explanationsAt, noise, problems, warnings }.
 */
export function findStructure(pages) {
  const problems = [];
  const warnings = [];
  const P = pages.map((p) => ({ ...p, items: readingOrder(p.items) }));
  const noise = noiseImages(P);

  // ---- big headings: sections, Answers, Explanations ----
  const headings = [];
  for (const p of P) for (const it of p.items) {
    const hd = headingOf(it);
    if (hd) headings.push({ ...hd, page: p.page, y: it.yTop, yBottom: it.yBottom });
  }
  const answersAt = headings.find((h) => h.type === 'answers') || null;
  const explanationsAt = headings.find((h) => h.type === 'explanations') || null;
  if (!answersAt) problems.push('No "Answers" page was found.');
  if (!explanationsAt) problems.push('No "Explanations" part was found.');
  const before = (a, b) => a.page < b.page || (a.page === b.page && a.y < b.y);
  const sectionHeads = headings.filter((h) => h.type === 'section' && (!answersAt || before(h, answersAt)));
  const order = sectionHeads.map((h) => h.key);
  if (order.join(',') !== 'varc,dilr,qa') problems.push(`The section headings should be VARC, LRDI and Quant in that order; found: ${sectionHeads.map((h) => h.key.toUpperCase()).join(', ') || 'none'}.`);
  if (problems.length) return { problems, warnings, sections: [], questions: [], sets: [], key: new Map(), solutions: [], answersAt, explanationsAt, noise };

  // ---- question pages: labels, options, instructions, in reading order ----
  const labelFont = (() => {
    const f = new Map();
    for (const p of P) for (const it of p.items) if (/^[A-D]$/.test(norm(it.str)) && it.x0 >= OPTION_X[0] && it.x0 <= OPTION_X[1]) f.set(it.fontName, (f.get(it.fontName) || 0) + 1);
    return [...f.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  })();
  const anchors = []; // { type, page, y, n?, key?, from?, to? }
  for (const h of sectionHeads) anchors.push({ type: 'section', page: h.page, y: h.y, key: h.key });
  anchors.push({ type: 'answers', page: answersAt.page, y: answersAt.y });
  let expected = 1;
  const questions = [];
  const sets = [];
  for (const p of P) {
    if (p.page > answersAt.page || (p.page === answersAt.page)) break;
    for (const it of p.items) {
      if (it.x0 < LABEL_X[0] || it.x0 > LABEL_X[1]) continue;
      const m = LABEL_RE.exec(it.str);
      if (m && Number(m[1]) === expected && (!labelFont || it.fontName === labelFont)) {
        questions.push({ n: expected, page: p.page, y: it.yTop, yBottom: it.yBottom });
        anchors.push({ type: 'label', page: p.page, y: it.yTop, n: expected });
        expected++;
        continue;
      }
      const im = INSTR_RE.exec(norm(it.str));
      if (im) {
        sets.push({ from: Number(im[1]), to: Number(im[2]), page: p.page, y: it.yTop });
        anchors.push({ type: 'instructions', page: p.page, y: it.yTop, from: Number(im[1]), to: Number(im[2]) });
      }
    }
  }
  const N = questions.length;
  // the label that should have come next: report where numbering broke
  {
    const stray = [];
    for (const p of P) {
      if (p.page >= answersAt.page) break;
      for (const it of p.items) {
        const m = LABEL_RE.exec(it.str);
        if (m && it.x0 >= LABEL_X[0] && it.x0 <= LABEL_X[1] && Number(m[1]) > N && Number(m[1]) <= N + 3 && it.fontName === labelFont) stray.push(`${m[1]}. on page ${p.page}`);
      }
    }
    if (stray.length) problems.push(`Question numbering breaks after ${N}: found ${stray.join(', ')} but not ${N + 1}. in between.`);
    else if (N < MIN_QUESTIONS) problems.push(`Only ${N} question labels (1., 2., …) were found before the Answers page.`);
  }

  // sections of the questions
  const secOf = (q) => {
    let cur = null;
    for (const h of sectionHeads) if (before(h, { page: q.page, y: q.y + 0.01 })) cur = h.key;
    return cur;
  };
  for (const q of questions) q.section = secOf(q);
  const sections = SECTION_NAMES.map((s) => {
    const qs = questions.filter((q) => q.section === s.key);
    return { key: s.key, display: s.display, subject: s.subject, from: qs[0]?.n ?? null, to: qs[qs.length - 1]?.n ?? null, count: qs.length };
  });
  for (const s of sections) if (!s.count) problems.push(`The ${s.display} section has no questions.`);
  for (const s of sections) {
    const qs = questions.filter((q) => q.section === s.key).map((q) => q.n);
    if (qs.length && qs[qs.length - 1] - qs[0] + 1 !== qs.length) problems.push(`The ${s.display} questions are not one continuous run.`);
  }

  // passage sets: check ranges
  for (const st of sets) {
    if (st.from > st.to || st.from < 1 || st.to > N) problems.push(`"Instructions [${st.from} - ${st.to}]" does not match the question numbers.`);
    const first = questions.find((q) => q.n === st.from);
    if (first && !before({ page: st.page, y: st.y }, first)) problems.push(`"Instructions [${st.from} - ${st.to}]" comes after question ${st.from}.`);
  }
  for (let i = 1; i < sets.length; i++) if (sets[i].from <= sets[i - 1].to) problems.push(`Passage sets overlap: [${sets[i - 1].from} - ${sets[i - 1].to}] and [${sets[i].from} - ${sets[i].to}].`);

  // ---- options per question ----
  anchors.sort((a, b) => a.page - b.page || a.y - b.y);
  const nextAnchor = (page, y) => anchors.find((a) => a.page > page || (a.page === page && a.y > y + 0.5)) || null;
  for (const q of questions) {
    const end = nextAnchor(q.page, q.y);
    q.end = end ? { page: end.page, y: end.y } : { page: P[P.length - 1].page, y: CONTENT.bottom };
    const opts = [];
    for (const p of P) {
      if (p.page < q.page || p.page > q.end.page) continue;
      for (const it of p.items) {
        if (p.page === q.page && it.yTop <= q.y + 0.5) continue;
        if (p.page === q.end.page && it.yTop >= q.end.y - 0.5) continue;
        const t = norm(it.str);
        if (/^[A-D]$/.test(t) && it.x0 >= OPTION_X[0] && it.x0 <= OPTION_X[1] && (!labelFont || it.fontName === labelFont)) opts.push({ letter: t, page: p.page, y: it.yTop, yTop: it.yTop, yBottom: it.yBottom, x1: it.x1 });
      }
    }
    const letters = opts.map((o) => o.letter).join('');
    q.options = letters === 'ABCD' ? opts : null;
    if (q.options) alignOptionCuts(q, P);
    q.markersFound = opts.length;
    if (opts.length && letters !== 'ABCD') warnings.push(`Q${q.n}: option letters found were "${letters}", not A, B, C, D; the whole question picture is used.`);
  }

  // ---- answer key: "n." then the value, on the Answers page(s) up to Explanations ----
  const key = new Map();
  const keyRects = new Map();
  for (const p of P) {
    if (p.page < answersAt.page) continue;
    if (explanationsAt && p.page > explanationsAt.page) break;
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i];
      if (p.page === answersAt.page && it.yTop < answersAt.y) continue;
      if (explanationsAt && p.page === explanationsAt.page && it.yTop >= explanationsAt.y) break;
      const m = /^(\d{1,3})\.\s*(\S.*)?$/.exec(norm(it.str));
      if (!m) continue;
      const n = Number(m[1]);
      let value = m[2] ? norm(m[2]) : null;
      let x1 = it.x1;
      if (!value) {
        const nxt = p.items[i + 1];
        if (nxt && Math.abs(nxt.yTop - it.yTop) < 3 && nxt.x0 >= it.x1 - 2 && nxt.x0 <= it.x1 + 14) { value = norm(nxt.str); x1 = nxt.x1; }
      }
      if (value && !key.has(n) && n >= 1 && n <= N) {
        key.set(n, value);
        keyRects.set(n, { page: p.page, x0: it.x0 - 3, y0: it.yTop - 3, x1: x1 + 3, y1: it.yBottom + 3 });
      }
    }
  }
  const missingKey = [];
  for (let n = 1; n <= N; n++) if (!key.has(n)) missingKey.push(n);
  if (missingKey.length) problems.push(`The Answers page has no entry for Q${missingKey.slice(0, 8).join(', Q')}${missingKey.length > 8 ? ', …' : ''}.`);

  // ---- explanations: "n." (then the value) at the left margin, from the Explanations heading ----
  const solutions = [];
  if (explanationsAt) {
    let exp = 1;
    const sAnchors = [];
    for (const p of P) {
      if (p.page < explanationsAt.page) continue;
      for (const it of p.items) {
        if (p.page === explanationsAt.page && it.yTop < explanationsAt.y) continue;
        const hd = headingOf(it);
        if (it.fontSize < 10 && it.fontSize > 6 && SECTION_NAMES.some((s) => s.names.includes(upper(it.str))) && it.x0 <= LABEL_X[1]) { sAnchors.push({ type: 'section', page: p.page, y: it.yTop }); continue; }
        if (hd) { sAnchors.push({ type: hd.type, page: p.page, y: it.yTop }); continue; }
        if (it.x0 < LABEL_X[0] || it.x0 > LABEL_X[1]) continue;
        const m = LABEL_RE.exec(it.str);
        if (m && Number(m[1]) === exp) {
          solutions.push({ n: exp, page: p.page, y: it.yTop });
          sAnchors.push({ type: 'label', page: p.page, y: it.yTop });
          exp++;
        }
      }
    }
    sAnchors.sort((a, b) => a.page - b.page || a.y - b.y);
    for (const s of solutions) {
      const end = sAnchors.find((a) => a.page > s.page || (a.page === s.page && a.y > s.y + 0.5));
      s.end = end ? { page: end.page, y: end.y } : { page: P[P.length - 1].page, y: CONTENT.bottom };
    }
    if (solutions.length !== N) problems.push(`${solutions.length} explanations were found for ${N} questions (numbering breaks after ${solutions.length}).`);
  }

  return { sections, questions, sets, key, keyRects, solutions, answersAt, explanationsAt, noise, problems, warnings, labelFont };
}

/**
 * Where each option's picture starts. The letter of an option that runs over several lines is
 * centred on those lines (a table cell), so cutting at the letter's top would start in the middle
 * of the option and show the end of the line before. On the letter's page, every text line to the
 * right of the letters goes to the option whose letter centre is nearest, but a line above a letter
 * is accepted only as far above as the option reaches below (the letter is centred): what is
 * further up is the stem (or the previous option continuing from the page before). An option's cut
 * is then half-way between the text before it and its own first line. o.y is the cut (regionParts
 * takes 1.5 pt off it); the letter's own top stays in o.letterY. If the cuts would not follow each
 * other properly, the letter cuts are kept.
 */
function alignOptionCuts(q, P) {
  const opts = q.options;
  const isLetter = (it) => /^[A-D]$/.test(norm(it.str)) && it.x0 >= OPTION_X[0] && it.x0 <= OPTION_X[1];
  const textX = Math.max(...opts.map((o) => o.x1)) + 1;
  const inRegion = (it, page) => it.yTop >= (page === q.page ? q.y - 0.5 : CONTENT.top) && (q.end.page !== page || it.yTop < q.end.y - 0.5) && it.yBottom > it.yTop && !isLetter(it);
  const centre = (o) => (o.yTop + o.yBottom) / 2;
  const bounds = opts.map((o) => ({ top: o.yTop, bottom: o.yBottom }));
  const cuts = opts.map((o) => o.yTop);
  for (const page of [...new Set(opts.map((o) => o.page))]) {
    const p = P.find((x) => x.page === page);
    if (!p) return;
    const idx = opts.map((o, i) => i).filter((i) => opts[i].page === page);
    const items = p.items.filter((it) => inRegion(it, page));
    const nearest = (c) => idx.reduce((best, i) => (Math.abs(c - centre(opts[i])) < Math.abs(c - centre(opts[best])) ? i : best), idx[0]);
    const right = items.filter((it) => it.x0 >= textX);
    // lines on or below their letter's centre first: they tell how far the option reaches down
    for (const it of right) {
      const c = centre(it); const i = nearest(c);
      if (c < centre(opts[i]) - 1) continue;
      bounds[i].top = Math.min(bounds[i].top, it.yTop); bounds[i].bottom = Math.max(bounds[i].bottom, it.yBottom);
    }
    // lines above the centre: only within the same reach (plus a little), else they are not this option's
    for (const it of right) {
      const c = centre(it); const i = nearest(c);
      if (c >= centre(opts[i]) - 1) continue;
      if (centre(opts[i]) - c <= bounds[i].bottom - centre(opts[i]) + 3) bounds[i].top = Math.min(bounds[i].top, it.yTop);
    }
    for (const i of idx) {
      const prevOnPage = idx.includes(i - 1);
      const from = prevOnPage ? bounds[i - 1].top : (page === q.page ? q.y - 0.5 : CONTENT.top);
      const before = items.filter((it) => it.yTop >= from && it.yBottom <= bounds[i].top + 0.5).map((it) => it.yBottom);
      const prevBottom = Math.max(prevOnPage ? bounds[i - 1].bottom : -Infinity, ...before);
      cuts[i] = Number.isFinite(prevBottom) && prevBottom < bounds[i].top ? (prevBottom + bounds[i].top) / 2 + 1.5 : bounds[i].top;
    }
  }
  // safety: cuts in order, above their letters, the stem not empty; otherwise keep the letter cuts
  for (let i = 0; i < opts.length; i++) {
    if (!(cuts[i] <= opts[i].yBottom)) return;
    if (i === 0 ? opts[0].page === q.page && !(cuts[0] > q.y + 2) : opts[i].page === opts[i - 1].page && !(cuts[i] >= cuts[i - 1] + 6)) return;
  }
  opts.forEach((o, i) => { o.letterY = o.yTop; o.y = cuts[i]; });
}

/**
 * Page parts (rectangles in points) of a region from (page, y) to end (page, y), split per page,
 * with the noise rectangles that fall inside each part as whiteouts.
 */
export function regionParts(start, end, pages, noise, { pad = 1.5, x0 = CONTENT.x0, x1 = CONTENT.x1 } = {}) {
  const parts = [];
  for (const p of pages) {
    if (p.page < start.page || p.page > end.page) continue;
    const top = p.page === start.page ? Math.max(CONTENT.top, start.y - pad) : CONTENT.top;
    const bottom = p.page === end.page ? Math.min(CONTENT.bottom, end.y - pad) : CONTENT.bottom;
    if (bottom - top < 2) continue;
    const whiteouts = (noise.get(p.page) || []).map((n) => n.rect).filter((r) => r.y1 > top && r.y0 < bottom)
      .map((r) => ({ x0: Math.max(x0, r.x0), y0: Math.max(top, r.y0), x1: Math.min(x1, r.x1), y1: Math.min(bottom, r.y1) }));
    parts.push({ page: p.page, rect: { x0, y0: top, x1, y1: bottom }, whiteouts });
  }
  return parts;
}

/** The "n." number of a set label used by the review page: "Q2–Q5". */
export const setLabel = (s) => `Q${s.from}–Q${s.to}`;

// ---------- validation of a mock draft (review page, batch) ----------
import { answerKind } from './validate.js';

/** Check a mock draft. Returns { errors, warnings, checks, counts, canSave }. */
export function validateMockDraft(draft) {
  const errors = [...(draft.structuralErrors || [])];
  const warnings = [...(draft.warnings || [])];
  const qs = draft.questions || [];
  const n = qs.length;
  let mcq = 0; let tita = 0; let unread = 0; let edited = 0; let fallback = 0; let typeConflicts = 0; let qImages = 0; let sImages = 0; let optionSets = 0;
  for (const q of qs) {
    const kind = answerKind(q.answer.value);
    if (q.answer.edited) edited++;
    if (kind === 'MCQ') mcq++;
    else if (kind === 'TITA') tita++;
    else { unread++; errors.push(q.answer.value ? `Q${q.n}: "${q.answer.value}" is not a valid answer. Use A, B, C or D, or a number.` : `Q${q.n}: the answer could not be read. Look at the answer-key picture and type it in.`); }
    if (q.images.question) qImages++; else errors.push(`Q${q.n}: no picture of the question could be made.`);
    if (q.setId && !q.images.passage) errors.push(`Q${q.n}: no picture of its passage could be made.`);
    if (q.images.solution) sImages++; else errors.push(`Q${q.n}: no picture of the explanation could be made.`);
    if (kind === 'MCQ') {
      if (q.optionsMode === 'separate') optionSets++;
      else { fallback++; warnings.push(q.markersFound > 0 ? `Q${q.n}: the options could not be cut out one by one, so the whole question picture is shown with a–d buttons below it.` : `Q${q.n}: the key says ${q.answer.value}, but no options A–D were found in the question. Please check the picture; if it is a typed-answer question, type the correct number.`); }
    }
    if (kind === 'TITA' && q.markersFound >= 2) { typeConflicts++; warnings.push(`Q${q.n}: the answer is a number (typed answer), but the question seems to have options A–D. Please check the answer.`); }
    for (const issue of q.issues || []) (issue.level === 'error' ? errors : warnings).push(`Q${q.n}: ${issue.text}`);
  }
  const secs = draft.sections || [];
  const checks = [
    { label: 'Questions found', ok: n > 0, detail: n ? `${n} (Q1–Q${n})` : 'none' },
    { label: 'Sections', ok: secs.length === 3 && secs.every((s) => s.count > 0), detail: secs.map((s) => `${s.display} Q${s.from}–Q${s.to} (${s.count})`).join(' · ') || 'none' },
    { label: 'Answer-key entries', ok: (draft.structure?.keyCount ?? n) === n, detail: `${draft.structure?.keyCount ?? n} of ${n}` },
    { label: 'Explanations found', ok: (draft.structure?.solutionCount ?? n) === n, detail: `${draft.structure?.solutionCount ?? n} of ${n}` },
    { label: 'MCQ / TITA split', ok: unread === 0, detail: `${mcq} MCQ, ${tita} TITA` + (unread ? `, ${unread} not yet known` : '') },
    { label: 'Answer type matches question', ok: typeConflicts === 0, detail: typeConflicts ? `${typeConflicts} to check` : 'yes' },
    { label: 'Question pictures', ok: qImages === n, detail: `${qImages} of ${n}` },
    { label: 'Explanation pictures', ok: sImages === n, detail: `${sImages} of ${n}` },
    { label: 'Options cut out one by one', ok: fallback === 0, detail: `${optionSets} of ${mcq} MCQs` + (fallback ? ` (${fallback} shown as whole question)` : '') },
    { label: 'Passage sets', ok: true, detail: (draft.sets || []).length ? draft.sets.map(setLabel).join(', ') : 'none' },
    { label: 'Banners, video thumbnails and watermark removed', ok: true, detail: `${draft.structure?.noiseCount ?? 0} removed` },
  ];
  return { errors, warnings, checks, counts: { questions: n, mcq, tita, unread, edited, fallback }, canSave: errors.length === 0 };
}
