// On-screen calculator like the one in the CAT exam (pure code). Operations are done left to right
// as you press them (2 + 3 * 4 = 20), like a simple pocket calculator.
// Keys: '0'-'9', '.', '+', '-', '*', '/', '=', '%', 'sqrt', 'recip' (1/x), 'neg' (+/-),
//       'BS' (delete last digit, the red arrow), 'C' (clear everything),
//       'MC' 'MR' 'MS' 'M+' 'M-' (memory: clear, recall, store, add, subtract).
// The upper line shows the calculation being built (e.g. "12 +") and "M" when memory is in use.

const OP_SIGN = { '+': '+', '-': '−', '*': '×', '/': '÷' };

export function newCalc() {
  return { display: '0', acc: null, op: null, fresh: true, error: false, memory: 0, hasMemory: false, expr: '' };
}

function fmt(n) {
  if (!Number.isFinite(n)) return null;
  const r = Number.parseFloat(n.toPrecision(12));
  const s = String(r);
  return s.length > 16 ? r.toExponential(8) : s;
}

function apply(a, op, b) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b === 0 ? NaN : a / b;
  return b;
}

const fail = (c) => ({ ...newCalc(), memory: c.memory, hasMemory: c.hasMemory, display: 'Error', error: true });

/** Replace the number on display with a computed value (used by √, 1/x, %, +/-, MR). */
function setValue(c, n, extra = {}) {
  const v = fmt(n);
  return v === null ? fail(c) : { ...c, display: v, fresh: true, ...extra };
}

export function press(c, key) {
  if (key === 'C') return { ...newCalc(), memory: c.memory, hasMemory: c.hasMemory };
  if (key === 'MC') return { ...c, memory: 0, hasMemory: false };
  if (c.error) return c;
  const cur = Number(c.display);
  if (key === 'MS') return { ...c, memory: cur, hasMemory: true, fresh: true };
  if (key === 'M+') return { ...c, memory: Number(fmt(c.memory + cur)), hasMemory: true, fresh: true };
  if (key === 'M-') return { ...c, memory: Number(fmt(c.memory - cur)), hasMemory: true, fresh: true };
  if (key === 'MR') return setValue(c, c.memory);
  if (/^[0-9]$/.test(key)) {
    if (c.fresh) return { ...c, display: key, fresh: false };
    if (c.display.replace(/[-.]/g, '').length >= 15) return c;
    return { ...c, display: c.display === '0' ? key : c.display === '-0' ? '-' + key : c.display + key };
  }
  if (key === '.') {
    if (c.fresh) return { ...c, display: '0.', fresh: false };
    return c.display.includes('.') ? c : { ...c, display: c.display + '.' };
  }
  if (key === 'BS') {
    if (c.fresh) return c;
    const d = c.display.slice(0, -1);
    return { ...c, display: d === '' || d === '-' ? '0' : d };
  }
  if (key === 'neg') {
    if (c.display === '0') return c;
    return { ...c, display: c.display.startsWith('-') ? c.display.slice(1) : '-' + c.display };
  }
  if (key === 'sqrt') return cur < 0 ? fail(c) : setValue(c, Math.sqrt(cur));
  if (key === 'recip') return cur === 0 ? fail(c) : setValue(c, 1 / cur);
  if (key === '%') {
    // like the exam calculator: a + b% = a + (a×b/100); a × b% = a × (b/100)
    if (c.op === '+' || c.op === '-') return setValue(c, (c.acc * cur) / 100);
    return setValue(c, cur / 100);
  }
  if (['+', '-', '*', '/', '='].includes(key)) {
    let acc = c.acc;
    let display = c.display;
    let expr;
    if (c.op && !c.fresh) {
      const r = fmt(apply(acc, c.op, Number(c.display)));
      if (r === null) return fail(c);
      expr = `${fmt(acc)} ${OP_SIGN[c.op]} ${c.display}`;
      display = r;
      acc = Number(r);
    } else if (c.op && c.fresh && key === '=') {
      // "=" right after an operator with a computed value (√, %, MR): use the shown value
      const r = fmt(apply(acc, c.op, Number(c.display)));
      if (r === null) return fail(c);
      expr = `${fmt(acc)} ${OP_SIGN[c.op]} ${c.display}`;
      display = r;
      acc = Number(r);
    } else if (!c.op || c.acc === null) {
      acc = Number(c.display);
    }
    if (key === '=') return { ...c, display, acc: null, op: null, fresh: true, expr: expr ? `${expr} =` : '' };
    return { ...c, display, acc, op: key, fresh: true, expr: `${display} ${OP_SIGN[key]}` };
  }
  return c;
}

/** The value "Use" puts into the typed-answer box, or null if the display is not a number. */
export function usableValue(c) {
  if (c.error) return null;
  const v = c.display.endsWith('.') ? c.display.slice(0, -1) : c.display;
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}
