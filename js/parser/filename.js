// Pre-fill subject / topic / DPP number from a PDF file name (pure code, unit-testable in Node).
// Example: "MBA 2026 - Quantitative Aptitude - Inequalities 2 - DPP 07.pdf"
//   -> { subject: 'Quantitative Aptitude', topic: 'Inequalities 2', dpp: '07' }
// Only a suggestion: the user always confirms it on the review page.

export const SUBJECTS = ['Quantitative Aptitude', 'VARC', 'LRDI'];

const SUBJECT_PATTERNS = [
  ['Quantitative Aptitude', /^(quant(itative)?(\s+aptitude)?|qa)$/i],
  ['VARC', /^(varc|verbal(\s+ability)?(\s*(&|and)\s*reading\s+comprehension)?)$/i],
  ['LRDI', /^(lrdi|dilr|logical\s+reasoning(\s*(&|and)\s*data\s+interpretation)?|data\s+interpretation(\s*(&|and)\s*logical\s+reasoning)?)$/i],
];

export function subjectFromText(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  for (const [name, re] of SUBJECT_PATTERNS) if (re.test(t)) return name;
  return null;
}

export function guessFromFileName(fileName) {
  const base = String(fileName || '').replace(/\.pdf$/i, '').trim();
  const parts = base.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  const dppMatch = base.match(/\bDPP\s*[:#-]?\s*(\d{1,3})\b/i);
  const dpp = dppMatch ? dppMatch[1] : null;
  let subject = null;
  let topic = null;
  const si = parts.findIndex((p) => subjectFromText(p));
  if (si >= 0) {
    subject = subjectFromText(parts[si]);
    const next = parts[si + 1];
    if (next && !/^DPP\b/i.test(next)) topic = next;
  }
  return { subject, topic, dpp, base };
}

/** Default test name shown on the review page. */
export function defaultTestName({ topic, dpp, base }) {
  if (topic) return dpp ? `${topic} – DPP ${dpp}` : topic;
  return base || 'Untitled test';
}
