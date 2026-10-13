// Validation report for a parsed test ("draft"), pure code, unit-testable in Node.
// Run once after parsing and again after every edit on the review page.

/** Normalise a typed (TITA) answer: returns the canonical number string, or null if not a number. */
export function normaliseNumber(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : null;
}

/** "A".."D" -> MCQ, a number -> TITA, anything else -> null (invalid). */
export function answerKind(value) {
  if (value == null || value === '') return null;
  if (/^[A-D]$/.test(String(value).trim().toUpperCase())) return 'MCQ';
  if (normaliseNumber(value) !== null) return 'TITA';
  return null;
}

/**
 * Check a draft. Returns { errors, warnings, checks, counts, canSave }.
 * - errors: things that must be fixed before saving (the PDF is refused if they come from the PDF itself)
 * - warnings: flagged but allowed (shown prominently on the review page)
 * - checks: the validation report lines [{ label, ok, detail }]
 */
export function validateDraft(draft) {
  const errors = [...(draft.structuralErrors || [])];
  const warnings = [...(draft.warnings || [])];
  const qs = draft.questions || [];
  const n = qs.length;
  let mcq = 0, tita = 0, unread = 0, edited = 0, typeConflicts = 0, fallback = 0;
  let qImages = 0, sImages = 0, optionSets = 0;
  for (const q of qs) {
    const kind = answerKind(q.answer.value);
    if (q.answer.edited) edited++;
    if (kind === 'MCQ') mcq++;
    else if (kind === 'TITA') tita++;
    else {
      unread++;
      errors.push(q.answer.value
        ? `Q${q.n}: "${q.answer.value}" is not a valid answer. Use A, B, C or D, or a number.`
        : `Q${q.n}: the answer could not be read clearly. Look at the answer-key picture and type it in.`);
    }
    if (q.images.question) qImages++;
    else errors.push(`Q${q.n}: no picture of the question could be made.`);
    if (q.setId && !q.images.passage) errors.push(`Q${q.n}: no picture of its passage could be made.`);
    if (q.images.solution) sImages++;
    else errors.push(`Q${q.n}: no picture of the solution could be made.`);
    if (kind === 'MCQ') {
      if (q.optionsMode === 'separate') optionSets++;
      else {
        fallback++;
        warnings.push(q.markersFound > 0
          ? `Q${q.n}: the options could not be cut out one by one, so the whole question picture is shown with a–d buttons below it.`
          : `Q${q.n}: the answer key says (${String(q.answer.value).toUpperCase()}), but no options (A)–(D) were found in this question. Please look at the question picture: if it really has no options, the PDF's answer key is probably wrong — type the correct number if you know it. Otherwise the test will show the whole question with a–d buttons.`);
      }
    }
    if (kind === 'TITA' && q.markersFound >= 2) {
      typeConflicts++;
      warnings.push(`Q${q.n}: the answer is a number (typed answer), but the question seems to contain options (A)–(D). Please check the answer.`);
    }
    for (const issue of q.issues || []) (issue.level === 'error' ? errors : warnings).push(`Q${q.n}: ${issue.text}`);
  }
  const subjectOk = !!(draft.header && draft.header.subject);
  const topicOk = !!(draft.header && draft.header.topic && draft.header.topic.trim());
  if (!subjectOk) errors.push('Choose the subject.');
  if (!topicOk) errors.push('Type the topic.');

  const s = draft.structure || {};
  const checks = [
    { label: 'Questions found', ok: n > 0 && !s.questionNumbering?.length, detail: n ? `${n} (Q1–Q${n})` : 'none' },
    { label: 'Answer-key entries', ok: (s.keyCount ?? n) === n && !s.keyNumbering?.length, detail: `${s.keyCount ?? n}` },
    { label: 'Solutions found', ok: (s.solutionCount ?? n) === n && !s.solutionNumbering?.length, detail: `${s.solutionCount ?? n}` },
    { label: 'MCQ / TITA split', ok: unread === 0, detail: `${mcq} MCQ, ${tita} TITA` + (unread ? `, ${unread} not yet known` : '') },
    { label: 'Answers read clearly', ok: unread === 0, detail: unread ? `${unread} need typing` : (edited ? `all (${edited} edited by you)` : 'all') },
    { label: 'Answer type matches question', ok: typeConflicts === 0, detail: typeConflicts ? `${typeConflicts} to check` : 'yes' },
    { label: 'Question pictures', ok: qImages === n, detail: `${qImages} of ${n}` },
    { label: 'Solution pictures', ok: sImages === n, detail: `${sImages} of ${n}` },
    { label: 'Options cut out one by one', ok: fallback === 0, detail: `${optionSets} of ${mcq} MCQs` + (fallback ? ` (${fallback} shown as whole question)` : '') },
    ...(s.sets && s.sets.length ? [{ label: 'Passage sets', ok: true, detail: s.sets.map((x) => `Q${x.from}–Q${x.to}`).join(', ') }] : []),
    { label: 'QR codes kept out of solutions', ok: !s.qrProblems?.length, detail: s.qrProblems?.length ? `${s.qrProblems.length} problem(s)` : 'yes' },
    { label: 'Faded logo removed', ok: true, detail: s.watermark || 'not needed' },
    { label: 'Subject and topic', ok: subjectOk && topicOk, detail: subjectOk && topicOk ? `${draft.header.subject} – ${draft.header.topic}` : 'missing' },
  ];
  return {
    errors,
    warnings,
    checks,
    counts: { questions: n, mcq, tita, unread, edited, fallback },
    canSave: errors.length === 0,
  };
}
