// Compact PNG encoding for black-and-white pictures (pure code apart from CompressionStream, a web
// standard also present in Node 18+). Greyscale pictures are stored with 16 grey levels (4 bits per
// pixel), which keeps text sharp and is several times smaller than the browser's colour PNG.
// Pictures that contain real colour are left to the browser's own PNG encoder by the caller.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard CRC-32 (as used by PNG and ZIP). crc32(bytes of "123456789") === 0xCBF43926. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Does an RGBA pixel array contain colour (not just greys)? */
export function hasColour(rgba, tolerance = 28) {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > tolerance) return true;
  }
  return false;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encode RGBA pixels (width x height) as a 4-bit greyscale PNG. Returns Uint8Array.
 * Each row gets the PNG filter (None/Sub/Up/Average/Paeth) that looks cheapest to compress.
 */
export async function encodeGrey4(rgba, width, height) {
  const rowBytes = Math.ceil(width / 2);
  const raw = new Uint8Array((rowBytes + 1) * height);
  let prev = new Uint8Array(rowBytes);
  const cur = new Uint8Array(rowBytes);
  const cand = new Uint8Array(rowBytes);
  const best = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    cur.fill(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
      const level = Math.round(lum / 17); // 0..15
      cur[x >> 1] |= x & 1 ? level : level << 4;
    }
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type <= 4; type++) {
      let cost = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i > 0 ? cur[i - 1] : 0;
        const b = prev[i];
        const c = i > 0 ? prev[i - 1] : 0;
        let v;
        if (type === 0) v = cur[i];
        else if (type === 1) v = cur[i] - a;
        else if (type === 2) v = cur[i] - b;
        else if (type === 3) v = cur[i] - ((a + b) >> 1);
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 0xff;
        cand[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        best.set(cand);
      }
    }
    const o = y * (rowBytes + 1);
    raw[o] = bestType;
    raw.set(best, o + 1);
    prev = cur.slice();
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 4; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
