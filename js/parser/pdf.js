// Thin wrapper around the vendored PDF.js (browser only).
// Coordinates returned by this module are in PDF points with a TOP-LEFT origin
// (x to the right, y downwards), i.e. the page as you see it at 72 dpi.
import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.mjs';

const BASE = new URL('../../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';

export const PDFJS_VERSION = pdfjsLib.version;

/** Open a PDF from bytes. Throws a friendly Error if it is not a readable PDF. */
export async function openPdf(bytes) {
  const task = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: BASE + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: BASE + 'standard_fonts/',
    wasmUrl: BASE + 'wasm/',
    iccUrl: BASE + 'iccs/',
    isEvalSupported: false,
    enableXfa: false,
  });
  try {
    return await task.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Please use a PDF without a password.');
    }
    throw new Error('This file could not be opened as a PDF (' + (err && err.message ? err.message : err) + ').');
  }
}

/** Page size in points (top-left origin, rotation applied). */
export function pageSize(page) {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * Where every raster image is painted on the page.
 * Returns [{ x0, y0, x1, y1, pxWidth, pxHeight, op }] in points (top-left origin).
 */
export async function getImagePlacements(page) {
  const OPS = pdfjsLib.OPS;
  const vp = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const imageOps = new Map([
    [OPS.paintImageXObject, 'image'],
    [OPS.paintInlineImageXObject, 'inline-image'],
    [OPS.paintImageMaskXObject, 'mask'],
    [OPS.paintSolidColorImageMask, 'mask'],
  ]);
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args && Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (imageOps.has(fn)) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => {
        const x = ctm[0] * u + ctm[2] * v + ctm[4];
        const y = ctm[1] * u + ctm[3] * v + ctm[5];
        return vp.convertToViewportPoint(x, y);
      });
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      let pxWidth = null;
      let pxHeight = null;
      if (fn === OPS.paintImageXObject) {
        pxWidth = args[1];
        pxHeight = args[2];
      } else if (args && args[0] && typeof args[0] === 'object') {
        pxWidth = args[0].width ?? null;
        pxHeight = args[0].height ?? null;
      }
      out.push({
        x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
        pxWidth, pxHeight, op: imageOps.get(fn),
      });
    }
  }
  return out;
}

/** Text items with positions in points (top-left origin). Empty array for PDFs without a text layer. */
export async function getTextItems(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || it.str.trim() === '') continue;
    const [a, b, c, d, e, f] = it.transform;
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 0;
    const [x0, yBase] = vp.convertToViewportPoint(e, f);
    const [x1] = vp.convertToViewportPoint(e + it.width, f);
    items.push({
      str: it.str,
      x0: Math.min(x0, x1),
      x1: Math.max(x0, x1),
      yBase,
      yTop: yBase - fontSize * 0.8,
      yBottom: yBase + fontSize * 0.2,
      fontSize,
      fontName: it.fontName,
    });
  }
  return items;
}

/**
 * Render a page to a canvas at `scale` (1 = 72 dpi).
 * `hideRects` (points, top-left origin): raster images painted exactly over one of these
 * rectangles (within `tolerancePt`) are skipped. Returns how many draws were skipped.
 */
export async function renderPage(page, scale, { hideRects = [], tolerancePt = 1.5, hideLarge = null } = {}) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let skipped = 0;
  // hideLarge = { minWidthPt, minHeightPt }: skip every raster image drawn at least this big (page-sized watermark tiles)
  if (hideRects.length || hideLarge) {
    const targets = hideRects.map((r) => ({ x0: r.x0 * scale, y0: r.y0 * scale, x1: r.x1 * scale, y1: r.y1 * scale }));
    const tol = Math.max(2, tolerancePt * scale);
    const original = ctx.drawImage;
    ctx.drawImage = function patchedDrawImage(img, ...a) {
      let dx, dy, dw, dh;
      if (a.length === 2) [dx, dy, dw, dh] = [a[0], a[1], img.width, img.height];
      else if (a.length === 4) [dx, dy, dw, dh] = a;
      else [dx, dy, dw, dh] = [a[4], a[5], a[6], a[7]];
      const m = this.getTransform();
      const pts = [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]].map(([x, y]) => [
        m.a * x + m.c * y + m.e,
        m.b * x + m.d * y + m.f,
      ]);
      const r = {
        x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])),
      };
      const big = hideLarge && (r.x1 - r.x0) >= hideLarge.minWidthPt * scale && (r.y1 - r.y0) >= hideLarge.minHeightPt * scale;
      const hit = big || targets.some((t) => Math.abs(t.x0 - r.x0) <= tol && Math.abs(t.x1 - r.x1) <= tol
        && Math.abs(t.y0 - r.y0) <= tol && Math.abs(t.y1 - r.y1) <= tol);
      if (hit) {
        skipped++;
        return undefined;
      }
      return original.call(this, img, ...a);
    };
  }
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, scale, skipped };
}

/** Grey-scale (0 = black, 255 = white) copy of a rendered canvas. */
export function canvasToGray(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
  }
  return { gray, width, height };
}
