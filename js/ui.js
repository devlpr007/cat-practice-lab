// Small DOM helpers shared by the pages (no framework).

/** Create an element: h('button', { class: 'btn', onClick: fn }, 'Text', child, ...). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Replace an element's content, skipping null/false entries (unlike el.replaceChildren). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/** Keeps track of object URLs made for pictures so they can be released when leaving a page. */
export class UrlBag {
  constructor() { this.urls = []; }
  url(blob) {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    return u;
  }
  free() {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }
}

/** A yes/no question in a dialog box. Resolves true only if the user clicks the OK button. */
export function confirmDialog({ title, message, okText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('h2', null, title),
      ...[].concat(message).map((m) => h('p', null, m)),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', type: 'button', onClick: () => dlg.close('cancel') }, cancelText),
        h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', onClick: () => dlg.close('ok') }, okText)));
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(dlg.returnValue === 'ok');
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Show a picture at full size in a dialog (click anywhere or press Esc to close). */
export function showPicture(src, caption) {
  const dlg = h('dialog', { class: 'dialog picture-dialog', onClick: () => dlg.close() },
    h('p', { class: 'muted' }, caption, ' — click anywhere to close'),
    h('img', { src, alt: caption }));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/** A picture shown at a size consistent across all crops (they share one render scale). */
export function picture(src, { width, height, alt = '', zoomable = true, scale = 0.55, maxWidth = '100%' } = {}) {
  const img = h('img', { src, alt, class: 'crop', loading: 'lazy', width: Math.round(width * scale), height: Math.round(height * scale) });
  img.style.maxWidth = maxWidth;
  img.style.height = 'auto';
  if (zoomable) {
    img.classList.add('zoomable');
    img.title = 'Click to enlarge';
    img.addEventListener('click', () => showPicture(src, alt));
  }
  return img;
}

/** Only the top `visibleHeight` pixels of a picture (used to show a question's stem). */
export function clippedPicture(src, { width, height, visibleHeight, alt = '', scale = 0.55 }) {
  const w = Math.round(width * scale);
  const wrap = h('div', { class: 'clip', style: { width: `${w}px`, maxWidth: '100%', aspectRatio: `${width} / ${visibleHeight}` } },
    h('img', { src, alt, class: 'crop', width: w, height: Math.round(height * scale), style: { width: '100%', height: 'auto' } }));
  wrap.title = 'Click to see the whole question picture';
  wrap.addEventListener('click', () => showPicture(src, alt));
  return wrap;
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatBytes(n) {
  if (n == null) return 'unknown';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
