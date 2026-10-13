// Pure image-analysis helpers on grey-scale page images (no browser APIs, unit-testable in Node).
// An image is { gray: Uint8Array, width, height } with 0 = black and 255 = white.
// Rectangles are { x0, y0, x1, y1 } in pixels, x1/y1 exclusive.

/** Pixels darker than this are "ink" (letters, digits, lines of a figure). */
export const INK = 140;
/** Pixels darker than this are "not white" (includes light grey lines and shading). */
export const MARK = 235;

export function clampRect(img, r) {
  return {
    x0: Math.max(0, Math.min(img.width, Math.floor(r.x0))),
    y0: Math.max(0, Math.min(img.height, Math.floor(r.y0))),
    x1: Math.max(0, Math.min(img.width, Math.ceil(r.x1))),
    y1: Math.max(0, Math.min(img.height, Math.ceil(r.y1))),
  };
}

/** For each row y0..y1-1: number of pixels in x0..x1-1 darker than thr. */
export function rowProfile(img, rect, thr = INK) {
  const r = clampRect(img, rect);
  const prof = new Int32Array(Math.max(0, r.y1 - r.y0));
  for (let y = r.y0; y < r.y1; y++) {
    let n = 0;
    const row = y * img.width;
    for (let x = r.x0; x < r.x1; x++) if (img.gray[row + x] < thr) n++;
    prof[y - r.y0] = n;
  }
  return prof;
}

/** For each column x0..x1-1: number of pixels in y0..y1-1 darker than thr. */
export function colProfile(img, rect, thr = INK) {
  const r = clampRect(img, rect);
  const prof = new Int32Array(Math.max(0, r.x1 - r.x0));
  for (let y = r.y0; y < r.y1; y++) {
    const row = y * img.width;
    for (let x = r.x0; x < r.x1; x++) if (img.gray[row + x] < thr) prof[x - r.x0]++;
  }
  return prof;
}

/**
 * Runs of non-zero entries in a profile, as [{ start, end }] (end exclusive), with `offset` added.
 * Runs separated by fewer than `minGap` zero entries are merged.
 */
export function runs(profile, { minGap = 1, offset = 0 } = {}) {
  const out = [];
  let start = -1;
  let lastNonZero = -1;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > 0) {
      if (start < 0) start = i;
      else if (i - lastNonZero - 1 >= minGap) {
        out.push({ start: start + offset, end: lastNonZero + 1 + offset });
        start = i;
      }
      lastNonZero = i;
    }
  }
  if (start >= 0) out.push({ start: start + offset, end: lastNonZero + 1 + offset });
  return out;
}

/** Bounding box of pixels darker than thr inside rect, or null if there are none. */
export function inkBox(img, rect, thr = INK) {
  const r = clampRect(img, rect);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = r.y0; y < r.y1; y++) {
    const row = y * img.width;
    for (let x = r.x0; x < r.x1; x++) {
      if (img.gray[row + x] < thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Number of pixels darker than thr inside rect. */
export function countInk(img, rect, thr = INK) {
  const r = clampRect(img, rect);
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    const row = y * img.width;
    for (let x = r.x0; x < r.x1; x++) if (img.gray[row + x] < thr) n++;
  }
  return n;
}

/**
 * 8-connected components of pixels darker than thr inside rect.
 * Returns { comps: [{ id, x0, y0, x1, y1, area }], labels: Int32Array, rect } where labels
 * (size rect.w * rect.h, 0 = background) lets callers extract one component's exact pixels.
 */
export function components(img, rect, thr = INK) {
  const r = clampRect(img, rect);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const labels = new Int32Array(Math.max(0, w * h));
  const comps = [];
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] !== 0 || img.gray[(y + r.y0) * img.width + x + r.x0] >= thr) continue;
      const id = comps.length + 1;
      const c = { id, x0: x, y0: y, x1: x, y1: y, area: 0 };
      labels[idx] = id;
      stack.push(idx);
      while (stack.length) {
        const p = stack.pop();
        const py = (p / w) | 0;
        const px = p - py * w;
        c.area++;
        if (px < c.x0) c.x0 = px;
        if (px > c.x1) c.x1 = px;
        if (py < c.y0) c.y0 = py;
        if (py > c.y1) c.y1 = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
            const q = ny * w + nx;
            if (labels[q] === 0 && img.gray[(ny + r.y0) * img.width + nx + r.x0] < thr) {
              labels[q] = id;
              stack.push(q);
            }
          }
        }
      }
      comps.push(c);
    }
  }
  for (const c of comps) {
    c.x0 += r.x0; c.x1 += r.x0 + 1; c.y0 += r.y0; c.y1 += r.y0 + 1;
  }
  return { comps, labels, rect: r };
}

/**
 * Long vertical lines (e.g. the rule between two text columns) between x = xFrom and xTo.
 * Returns [{ x0, x1, y0, y1 }] for runs of non-white pixels at least minLen pixels tall.
 */
export function verticalLines(img, xFrom, xTo, minLen, thr = MARK) {
  const found = [];
  for (let x = Math.max(0, Math.floor(xFrom)); x < Math.min(img.width, Math.ceil(xTo)); x++) {
    let start = -1;
    for (let y = 0; y <= img.height; y++) {
      const dark = y < img.height && img.gray[y * img.width + x] < thr;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start >= minLen) found.push({ x, y0: start, y1: y });
        start = -1;
      }
    }
  }
  // merge neighbouring columns into lines
  found.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const lines = [];
  for (const f of found) {
    const l = lines.find((L) => f.x - L.x1 <= 1 && f.y0 < L.y1 && f.y1 > L.y0);
    if (l) {
      l.x1 = f.x + 1;
      l.y0 = Math.min(l.y0, f.y0);
      l.y1 = Math.max(l.y1, f.y1);
    } else {
      lines.push({ x0: f.x, x1: f.x + 1, y0: f.y0, y1: f.y1 });
    }
  }
  return lines;
}
