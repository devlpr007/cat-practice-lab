// Stage 6d: charts drawn in code (SVG / plain HTML, no library) for the Progress page. Each
// function takes numbers the app already computed and returns an element; nothing here reads data.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const k of kids) e.append(k);
  return e;
};
const text = (x, y, s, cls, anchor = 'middle') => { const t = el('text', { x, y, class: cls, 'text-anchor': anchor }); t.textContent = s; return t; };
const div = (cls, ...kids) => { const d = document.createElement('div'); if (cls) d.className = cls; d.append(...kids.filter((k) => k != null)); return d; };
const span = (cls, s) => { const e = document.createElement('span'); if (cls) e.className = cls; e.textContent = s; return e; };

/** Radar of the three powers (ink style, values scaled to the largest, at least 100). */
export function radarChart(items) {
  const max = Math.max(100, ...items.map((i) => i.value));
  const cx = 150; const cy = 140; const R = 104;
  const pt = (i, f) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length; return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f]; };
  const ring = (f) => items.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = items.map((it, i) => pt(i, Math.max(0.03, it.value / max)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const svg = el('svg', { viewBox: '0 0 300 270', class: 'chart radar2', role: 'img', 'aria-label': `Power: ${items.map((i) => `${i.label} ${i.value}`).join(', ')}` });
  for (const f of [1, 0.75, 0.5, 0.25]) svg.append(el('polygon', { points: ring(f), class: 'radar-ring' }));
  items.forEach((_, i) => { const [x, y] = pt(i, 1); svg.append(el('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'radar-spoke' })); });
  svg.append(el('polygon', { points: shape, class: 'radar-shape' }));
  items.forEach((it, i) => {
    const [x, y] = pt(i, Math.max(0.03, it.value / max));
    svg.append(el('circle', { cx: x, cy: y, r: 4.5, class: 'radar-dot' }));
    const [lx, ly] = pt(i, 1.24);
    svg.append(text(lx, ly, it.label, 'radar-label'));
    svg.append(text(lx, ly + 15, String(it.value), 'radar-value'));
  });
  return svg;
}

/**
 * Line chart of accuracy per test over time; series = [{ label, points: [{ at, accuracy, name }] }].
 * Up to 5 series; x = order of tests (time), y = 0..100 %.
 */
export function trendChart(series, { width = 560, height = 220 } = {}) {
  const L = 36; const Rr = 12; const T = 14; const B = 30;
  const w = width - L - Rr; const hh = height - T - B;
  const all = series.flatMap((s) => s.points);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart trend', role: 'img', 'aria-label': series.map((s) => `${s.label}: ${s.points.map((p) => `${p.accuracy}%`).join(', ')}`).join('; ') });
  for (const v of [0, 25, 50, 75, 100]) {
    const y = T + hh - (v / 100) * hh;
    svg.append(el('line', { x1: L, y1: y, x2: L + w, y2: y, class: v === 0 ? 'axis' : 'grid' }));
    svg.append(text(L - 6, y + 4, `${v}%`, 'tick', 'end'));
  }
  if (!all.length) { svg.append(text(L + w / 2, T + hh / 2, 'No tests yet', 'empty')); return svg; }
  const times = [...new Set(all.map((p) => p.at))].sort((a, b) => a - b);
  const xOf = (at) => (times.length < 2 ? L + w / 2 : L + (times.indexOf(at) / (times.length - 1)) * w);
  series.forEach((s, si) => {
    if (!s.points.length) return;
    const pts = s.points.map((p) => [xOf(p.at), T + hh - (p.accuracy / 100) * hh]);
    svg.append(el('polyline', { points: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), class: `series s${si}` }));
    pts.forEach(([x, y], i) => {
      const c = el('circle', { cx: x, cy: y, r: 4, class: `dot s${si}` });
      c.append(el('title', {}, `${s.label} · ${s.points[i].name}: ${s.points[i].accuracy}%`));
      svg.append(c);
    });
  });
  const first = new Date(times[0]); const last = new Date(times[times.length - 1]);
  const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  svg.append(text(L, height - 8, times.length > 1 ? fmt(first) : `${fmt(first)} · ${times.length === 1 ? '1 test' : ''}`.replace(/ · $/, ''), 'tick', 'start'));
  if (times.length > 1 && fmt(first) !== fmt(last)) svg.append(text(L + w, height - 8, fmt(last), 'tick', 'end'));
  else if (times.length > 1) svg.append(text(L + w, height - 8, `${times.length} tests`, 'tick', 'end'));
  return svg;
}

/**
 * Speed against CAT pace, one row per subject: rows = [{ label, value, target, text }], times in ms,
 * text = "m:ss / m:ss" (yours / pace). Plain HTML so the bars fill the panel without stretching.
 */
export function speedBars(rows) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.value || 0, r.target || 0])) * 1.12;
  const pct = (v) => `${Math.min(100, (v / max) * 100).toFixed(1)}%`;
  const list = div('speed-list');
  list.setAttribute('role', 'img');
  list.setAttribute('aria-label', rows.map((r) => `${r.label}: ${r.text}`).join('; '));
  for (const r of rows) {
    const state = r.value == null ? 'none' : r.value > r.target ? 'slow' : 'ok';
    const [mine, pace] = r.text.split(' / ');
    const track = div('speed-track');
    if (r.value != null) { const f = div('speed-fill'); f.style.width = pct(r.value); track.append(f); }
    const target = div('speed-target'); target.style.left = pct(r.target); target.title = `CAT pace ${pace} per question`; track.append(target);
    list.append(div(`speed-row ${state}`,
      div('speed-head', span('speed-label', r.label), span('speed-note', state === 'none' ? 'No answers yet' : state === 'slow' ? 'Slower than CAT pace' : 'Within CAT pace')),
      track,
      div('speed-foot', span('speed-mine', state === 'none' ? 'Take a test in this subject to see your pace' : `Your average ${mine} per question`), span('speed-pace', `CAT pace ${pace}`))));
  }
  return list;
}

/** Colour levels of the practice calendar (0 = nothing, 4 = 50+ answered). */
const LEVEL_OF = (n) => (n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4);

/**
 * Calendar heatmap (weeks x 7 days), one square per day, darker = more questions answered. Drawn
 * at its natural size (the squares never stretch), with month and weekday labels and a legend.
 */
export function calendarHeatmap(answeredPerDay, todayMs, weeks = 20) {
  const end = new Date(todayMs); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cell = 15; const gap = 4; const left = 34; const top = 20;
  const W = left + weeks * (cell + gap); const H = top + 7 * (cell + gap);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart heatmap2', role: 'img', 'aria-label': 'Calendar of the days you practised' });
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => svg.append(text(left - 8, top + (i * 2) * (cell + gap) + cell - 3, d, 'tick', 'end')));
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayKey = key(end);
  const d = new Date(start);
  let lastMonth = -1;
  for (let wk = 0; wk < weeks; wk++) {
    for (let k = 0; k < 7; k++) {
      if (d <= end) {
        const dk = key(d);
        const n = answeredPerDay.get(dk) || 0;
        const r = el('rect', { x: left + wk * (cell + gap), y: top + k * (cell + gap), width: cell, height: cell, rx: 3, class: `hm hm-${LEVEL_OF(n)}${dk === todayKey ? ' hm-today' : ''}` });
        r.append(el('title', {}, `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}: ${n} answered`));
        svg.append(r);
        if (k === 0 && d.getMonth() !== lastMonth) { lastMonth = d.getMonth(); svg.append(text(left + wk * (cell + gap), 11, d.toLocaleDateString('en-IN', { month: 'short' }), 'tick', 'start')); }
      }
      d.setDate(d.getDate() + 1);
    }
  }
  const legend = div('hm-legend', span(null, 'Less'), ...[0, 1, 2, 3, 4].map((l) => { const i = document.createElement('i'); i.className = `l${l}`; i.title = ['0', '1–9', '10–24', '25–49', '50+'][l] + ' answered'; return i; }), span(null, 'More'));
  const wrap = div('heatmap-wrap', svg, legend);
  return wrap;
}
