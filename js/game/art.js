// Stage 6 artwork: ORIGINAL drawings made only from simple SVG shapes in this file (no images,
// characters or art from any game, anime or film). Each function returns an SVG element.
const NS = 'http://www.w3.org/2000/svg';

/** Build an SVG element from a markup string (all markup here is fixed, numbers only). */
function svg(markup, { cls = '', label = '' } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild;
  if (cls) el.setAttribute('class', cls);
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Hilltop castle at night: sky, moon, far mountains, castle with layered roofs, near hill. Layers can move (parallax). */
export function castleScene({ moon = 'pale' } = {}) {
  const moonFill = moon === 'silver' ? '#e8eef7' : '#f6efd6';
  return svg(`
<svg xmlns="${NS}" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1026"/><stop offset="0.6" stop-color="#1d2550"/><stop offset="1" stop-color="#3a2f5c"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${moonFill}" stop-opacity="0.55"/><stop offset="1" stop-color="${moonFill}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="420" fill="url(#sky)"/>
  <g class="layer layer-sky">
    <circle cx="930" cy="95" r="120" fill="url(#glow)"/>
    <circle cx="930" cy="95" r="46" fill="${moonFill}"/>
    <g fill="#fff" opacity="0.7"><circle cx="120" cy="60" r="1.6"/><circle cx="300" cy="110" r="1.2"/><circle cx="480" cy="40" r="1.4"/><circle cx="640" cy="90" r="1"/><circle cx="760" cy="30" r="1.5"/><circle cx="1080" cy="160" r="1.2"/><circle cx="210" cy="150" r="1"/><circle cx="1130" cy="50" r="1.4"/></g>
  </g>
  <g class="layer layer-far"><path d="M0 300 L140 210 L260 270 L400 180 L560 280 L700 200 L860 290 L1000 220 L1200 300 L1200 420 L0 420Z" fill="#2a2d55"/></g>
  <g class="layer layer-mid">
    <path d="M0 340 Q300 250 600 300 T1200 330 L1200 420 L0 420Z" fill="#1b1c3a"/>
    <g transform="translate(520 120)" fill="#101127">
      <rect x="40" y="140" width="120" height="70"/>
      <path d="M10 150 L100 118 L190 150 Z"/><rect x="55" y="92" width="90" height="30"/>
      <path d="M30 100 L100 70 L170 100 Z"/><rect x="70" y="52" width="60" height="22"/>
      <path d="M50 58 L100 30 L150 58 Z"/><rect x="96" y="14" width="8" height="18"/>
      <path d="M-30 210 L230 210 L250 232 L-50 232 Z"/>
      <g fill="#f3c969" opacity="0.85"><rect x="62" y="160" width="10" height="14"/><rect x="128" y="160" width="10" height="14"/><rect x="95" y="100" width="10" height="12"/><rect x="95" y="60" width="10" height="10"/></g>
    </g>
  </g>
  <g class="layer layer-near">
    <path d="M0 380 Q250 340 520 372 T1200 368 L1200 420 L0 420Z" fill="#0a0b1c"/>
    <path d="M0 120 C60 140 120 150 190 190 M80 145 C90 120 110 110 130 112 M150 172 C160 150 180 142 200 146" stroke="#3b2430" stroke-width="7" fill="none" stroke-linecap="round"/>
    <g fill="#f7b6c8"><circle cx="40" cy="128" r="9"/><circle cx="96" cy="140" r="8"/><circle cx="130" cy="110" r="9"/><circle cx="160" cy="168" r="8"/><circle cx="200" cy="146" r="9"/><circle cx="190" cy="190" r="7"/><circle cx="70" cy="132" r="6"/></g>
  </g>
</svg>`, { cls: 'castle-scene', label: 'A hilltop castle at night under the moon, with a cherry-blossom branch' });
}

/** Emblem per dojo: crossed blade (Quant), brush and scroll (VARC), lantern over a Go board (LRDI). */
export function dojoEmblem(key) {
  const art = {
    quant: `<g><circle cx="50" cy="50" r="46" fill="#2b2f36"/><path d="M24 76 L72 28" stroke="#d9dde3" stroke-width="7" stroke-linecap="round"/><path d="M72 28 L80 20" stroke="#fff" stroke-width="4" stroke-linecap="round"/><rect x="18" y="70" width="16" height="7" rx="2" transform="rotate(-45 26 73)" fill="#b3202a"/><path d="M30 76 L22 84" stroke="#111" stroke-width="7" stroke-linecap="round"/><g fill="#ff8a3d"><circle cx="70" cy="64" r="2.5"/><circle cx="78" cy="56" r="1.8"/><circle cx="64" cy="72" r="1.6"/></g></g>`,
    varc: `<g><circle cx="50" cy="50" r="46" fill="#efe6d2"/><rect x="22" y="30" width="56" height="40" rx="3" fill="#fbf7ee" stroke="#8b7a5a" stroke-width="2"/><rect x="18" y="28" width="6" height="44" rx="3" fill="#6b4f2a"/><rect x="76" y="28" width="6" height="44" rx="3" fill="#6b4f2a"/><path d="M32 42 H66 M32 50 H60 M32 58 H64" stroke="#1d1d1d" stroke-width="2.4" stroke-linecap="round"/><path d="M62 78 L80 52" stroke="#3a2a1a" stroke-width="4" stroke-linecap="round"/><path d="M60 82 L64 76" stroke="#111" stroke-width="6" stroke-linecap="round"/></g>`,
    lrdi: `<g><circle cx="50" cy="50" r="46" fill="#1d2b2f"/><rect x="24" y="56" width="52" height="28" rx="2" fill="#c9a86a"/><path d="M24 63 H76 M24 70 H76 M24 77 H76 M37 56 V84 M50 56 V84 M63 56 V84" stroke="#5b4426" stroke-width="1"/><circle cx="37" cy="63" r="4" fill="#111"/><circle cx="50" cy="70" r="4" fill="#f4f4f4"/><circle cx="63" cy="63" r="4" fill="#111"/><path d="M50 14 V22" stroke="#999" stroke-width="2"/><rect x="40" y="22" width="20" height="26" rx="8" fill="#e6553a"/><rect x="40" y="22" width="20" height="26" rx="8" fill="#ffd27a" opacity="0.35"/><path d="M40 30 H60 M40 40 H60" stroke="#8a2a18" stroke-width="1.5"/></g>`,
  }[key];
  return svg(`<svg xmlns="${NS}" viewBox="0 0 100 100">${art}</svg>`, { cls: `emblem emblem-${key}` });
}

/** A simple original oni-style mask for topic bosses; colour shows its state. */
export function bossMask(state) {
  const face = { locked: '#9aa3ad', learning: '#c0392b', returned: '#7d3c98', mastered: '#2e9d5b' }[state] || '#c0392b';
  return svg(`<svg xmlns="${NS}" viewBox="0 0 60 60"><path d="M12 18 L6 4 L22 14 M48 18 L54 4 L38 14" fill="#f2e3c6" stroke="#5a4630" stroke-width="1.5"/><circle cx="30" cy="34" r="22" fill="${face}"/><path d="M17 28 L26 31 M43 28 L34 31" stroke="#111" stroke-width="3" stroke-linecap="round"/><circle cx="23" cy="34" r="3" fill="#fff6"/><circle cx="37" cy="34" r="3" fill="#fff6"/><path d="M20 44 Q30 52 40 44" stroke="#111" stroke-width="3" fill="none"/><path d="M24 45 L25 49 M36 45 L35 49" stroke="#fff" stroke-width="2"/></svg>`, { cls: `boss boss-${state}` });
}

/**
 * Ink-painted sakura tree: a gnarled trunk and a crown of layered branches drawn as tapered brush
 * strokes, an ink wash behind, buds on the bare twigs and one blossom cluster per practice day,
 * placed along the branches in a fixed order (so the tree grows the same way every time).
 */
export function sakuraTree(blossoms) {
  // tapered brush strokes: [x1 y1 cx cy x2 y2 width1 width2]
  const strokes = [
    // trunk (two strokes for a gnarled look) and roots
    [152, 226, 138, 184, 146, 140, 26, 14], [150, 148, 154, 116, 150, 86, 15, 7],
    [128, 228, 150, 224, 176, 228, 10, 10], [150, 226, 134, 236, 108, 238, 8, 3], [152, 226, 170, 236, 196, 238, 8, 3],
    // main limbs
    [150, 150, 112, 140, 66, 122, 10, 3], [150, 128, 112, 100, 72, 76, 9, 3], [150, 98, 180, 72, 226, 58, 9, 3],
    [152, 138, 192, 128, 240, 134, 8, 3], [150, 88, 142, 60, 122, 36, 7, 2.5], [150, 90, 166, 62, 184, 40, 7, 2.5],
    // secondary branches
    [96, 130, 80, 110, 58, 100, 4, 1.5], [84, 128, 72, 142, 48, 150, 4, 1.5], [110, 102, 96, 86, 84, 66, 4, 1.5],
    [100, 92, 86, 94, 60, 90, 3.5, 1.3], [190, 70, 200, 52, 206, 32, 4, 1.5], [196, 66, 214, 70, 236, 74, 3.5, 1.3],
    [212, 130, 224, 114, 246, 108, 4, 1.5], [208, 132, 226, 146, 250, 152, 3.5, 1.3], [138, 52, 126, 44, 108, 46, 3, 1.2],
    [132, 46, 134, 30, 140, 16, 3, 1.2], [172, 50, 180, 36, 176, 20, 3, 1.2], [176, 44, 192, 40, 204, 28, 3, 1.2],
    [72, 124, 54, 116, 38, 120, 3, 1.2], [230, 60, 246, 56, 262, 62, 3, 1.2], [128, 100, 118, 108, 104, 118, 3, 1.2],
  ];
  const stroke = ([x1, y1, cx, cy, x2, y2, w1, w2]) => {
    const n = 14; const pts = []; const back = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const u = 1 - t;
      const x = u * u * x1 + 2 * u * t * cx + t * t * x2; const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
      const dx = 2 * u * (cx - x1) + 2 * t * (x2 - cx); const dy = 2 * u * (cy - y1) + 2 * t * (y2 - cy);
      const len = Math.hypot(dx, dy) || 1; const w = (w1 + (w2 - w1) * t) / 2;
      const nx = -dy / len * w; const ny = dx / len * w;
      pts.push(`${(x + nx).toFixed(1)},${(y + ny).toFixed(1)}`); back.push(`${(x - nx).toFixed(1)},${(y - ny).toFixed(1)}`);
    }
    return `<polygon points="${pts.concat(back.reverse()).join(' ')}" fill="url(#ink)"/>`;
  };
  // blossom spots along the branches (skip trunk and roots), fixed pseudo-random order
  const branchy = strokes.slice(5);
  const spots = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 120; i++) {
    const s = branchy[Math.floor(rnd() * branchy.length)];
    const t = 0.2 + rnd() * 0.8; const u = 1 - t;
    const x = u * u * s[0] + 2 * u * t * s[2] + t * t * s[4]; const y = u * u * s[1] + 2 * u * t * s[3] + t * t * s[5];
    spots.push([x + (rnd() - 0.5) * 18, y + (rnd() - 0.5) * 16, 5 + rnd() * 3.5, rnd() * 360]);
  }
  const shown = Math.min(blossoms, spots.length);
  const petal = (r) => `M0,0 C${(r * 0.55).toFixed(1)},${(-r * 0.9).toFixed(1)} ${(r * 1.1).toFixed(1)},${(-r * 0.4).toFixed(1)} 0,${(r * 0.35).toFixed(1)} C${(-r * 1.1).toFixed(1)},${(-r * 0.4).toFixed(1)} ${(-r * 0.55).toFixed(1)},${(-r * 0.9).toFixed(1)} 0,0`;
  const flowers = spots.slice(0, shown).map(([x, y, r, rot], i) => {
    const fill = i % 3 ? '#f4b6c7' : '#fbd4df';
    const petals = [0, 72, 144, 216, 288].map((a) => `<path d="${petal(r)}" transform="rotate(${a}) translate(0 ${(-r * 0.25).toFixed(1)})" fill="${fill}" stroke="#d98aa3" stroke-width="0.5"/>`).join('');
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)})">${petals}<circle r="${(r * 0.3).toFixed(1)}" fill="#c9452f"/></g>`;
  }).join('');
  const buds = spots.slice(shown, shown + 24).map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#8c2f3c" opacity="0.85"/>`).join('');
  // soft pink haze grows with the blossoms (a hint of the full crown to come)
  const haze = shown ? `<ellipse cx="150" cy="92" rx="${(70 + shown * 0.6).toFixed(0)}" ry="${(44 + shown * 0.35).toFixed(0)}" fill="#f4b6c7" opacity="${Math.min(0.35, 0.06 + shown * 0.004).toFixed(2)}"/>` : '';
  return svg(`<svg xmlns="${NS}" viewBox="0 0 300 250">
<defs>
<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2b3a"/><stop offset="1" stop-color="#121120"/></linearGradient>
<radialGradient id="wash" cx="0.5" cy="0.45" r="0.55"><stop offset="0" stop-color="#6b6a80" stop-opacity="0.28"/><stop offset="0.7" stop-color="#6b6a80" stop-opacity="0.08"/><stop offset="1" stop-color="#6b6a80" stop-opacity="0"/></radialGradient>
<radialGradient id="ground" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#3b3a4a" stop-opacity="0.5"/><stop offset="1" stop-color="#3b3a4a" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="150" cy="100" rx="140" ry="95" fill="url(#wash)"/>
<circle cx="236" cy="40" r="22" fill="#f6ecd2" opacity="0.55"/>
<ellipse cx="150" cy="232" rx="120" ry="10" fill="url(#ground)"/>
${haze}${strokes.map(stroke).join('')}${buds}${flowers}
<path d="M40 238 Q150 228 262 238" stroke="#2d2b3a" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
<path d="M60 243 Q150 236 240 243" stroke="#2d2b3a" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.35"/>
</svg>`, { cls: 'sakura-tree', label: `Sakura tree with ${shown} blossom${shown === 1 ? '' : 's'}, one for each day you practised` });
}

/** Radar chart of the three powers (values scaled to the largest, at least 100). */
export function radar(items) {
  const max = Math.max(100, ...items.map((i) => i.value));
  const cx = 130; const cy = 120; const R = 90;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const ring = (f) => items.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = items.map((it, i) => pt(i, Math.max(0.03, it.value / max)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const labels = items.map((it, i) => {
    const [x, y] = pt(i, 1.22);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" class="radar-label">${it.label}</text><text x="${x.toFixed(1)}" y="${(y + 14).toFixed(1)}" text-anchor="middle" class="radar-value">${it.value}</text>`;
  }).join('');
  return svg(`<svg xmlns="${NS}" viewBox="0 0 260 250"><g fill="none" stroke="#c9b98f" stroke-width="1"><polygon points="${ring(1)}"/><polygon points="${ring(0.66)}"/><polygon points="${ring(0.33)}"/></g><polygon points="${shape}" fill="#b3202a55" stroke="#b3202a" stroke-width="2"/>${labels}</svg>`,
    { cls: 'radar', label: `Power: ${items.map((i) => `${i.label} ${i.value}`).join(', ')}` });
}

/** Practice calendar: last `weeks` weeks, one square per day, darker = more questions answered. */
export function heatmap(answeredPerDay, todayMs, weeks = 18) {
  const end = new Date(todayMs); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cells = [];
  const d = new Date(start);
  for (let w = 0; w < weeks; w++) {
    for (let k = 0; k < 7; k++) {
      if (d <= end) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const n = answeredPerDay.get(key) || 0;
        const level = n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4;
        cells.push(`<rect x="${w * 14}" y="${k * 14}" width="12" height="12" rx="2" class="hm hm-${level}"><title>${key}: ${n} answered</title></rect>`);
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return svg(`<svg xmlns="${NS}" viewBox="0 0 ${weeks * 14} 98">${cells.join('')}</svg>`, { cls: 'heatmap', label: 'Calendar of the days you practised' });
}

/** Header art per dojo: forge sparks, bamboo under a pale moon, mist with lanterns. */
export function dojoBanner(key) {
  const art = {
    quant: `<rect width="1200" height="200" fill="#1a1c20"/><path d="M0 200 L0 150 Q600 110 1200 150 L1200 200Z" fill="#2b2f36"/><rect x="980" y="90" width="140" height="70" rx="6" fill="#3a3f47"/><path d="M990 90 Q1050 30 1110 90" fill="#b3202a" opacity="0.8"/><g class="sparks" fill="#ff8a3d"><circle cx="1040" cy="70" r="3"/><circle cx="1010" cy="50" r="2"/><circle cx="1075" cy="45" r="2.5"/><circle cx="1050" cy="25" r="1.8"/><circle cx="1090" cy="60" r="2"/></g><path d="M80 170 L520 60" stroke="#c9ced6" stroke-width="6" stroke-linecap="round"/><path d="M60 175 L90 168" stroke="#b3202a" stroke-width="10" stroke-linecap="round"/>`,
    varc: `<rect width="1200" height="200" fill="#efe6d2"/><circle cx="980" cy="70" r="42" fill="#fbf7ee" stroke="#d8ccb0"/><g stroke="#3d5a3a" stroke-width="9" stroke-linecap="round"><path d="M80 200 V10"/><path d="M140 200 V30"/><path d="M1100 200 V20"/><path d="M1150 200 V50"/></g><g stroke="#efe6d2" stroke-width="3"><path d="M74 60 H86 M74 120 H86 M134 80 H146 M134 150 H146 M1094 70 H1106 M1094 140 H1106"/></g><g fill="#5c7a4a"><path d="M86 70 q30 -10 50 6 q-28 2 -50 -6z"/><path d="M1100 90 q-30 -10 -52 4 q28 4 52 -4z"/></g><path d="M300 140 C420 100 560 160 700 120" stroke="#1d1d1d" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>`,
    lrdi: `<rect width="1200" height="200" fill="#16222a"/><g fill="#9fb3bf" opacity="0.18"><ellipse cx="300" cy="150" rx="320" ry="40"/><ellipse cx="900" cy="120" rx="360" ry="36"/></g><g><path d="M200 0 V40" stroke="#777" stroke-width="2"/><rect x="186" y="40" width="28" height="40" rx="11" fill="#e6553a"/><path d="M980 0 V60" stroke="#777" stroke-width="2"/><rect x="966" y="60" width="28" height="40" rx="11" fill="#e6553a"/></g><g transform="translate(520 70)"><rect width="160" height="110" rx="4" fill="#c9a86a"/><path d="M0 22 H160 M0 44 H160 M0 66 H160 M0 88 H160 M32 0 V110 M64 0 V110 M96 0 V110 M128 0 V110" stroke="#5b4426"/><circle cx="32" cy="44" r="9" fill="#111"/><circle cx="64" cy="66" r="9" fill="#f4f4f4"/><circle cx="96" cy="44" r="9" fill="#111"/><circle cx="96" cy="88" r="9" fill="#f4f4f4"/></g>`,
  }[key];
  return svg(`<svg xmlns="${NS}" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMid slice">${art}</svg>`, { cls: `dojo-banner dojo-banner-${key}` });
}
