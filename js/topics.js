// Topic structure (pure code, unit-testable in Node), agreed with the user 2026-10-13:
//   Subject -> Topic (here called "area": Arithmetic, Algebra, ... / VA, RC / DI, LR, LR based DI)
//           -> Sub-topic (here "chapter": Percentage, Ratio & Proportion, ...).
// The PDF heading gives a raw name ("PERCENTAGES 2", "DTS 4 - Relative Speed"); this file turns it
// into a clean sub-topic with a fixed table, and takes the topic from the file name
// ("Number_System_DPP__...") or from the sub-topic. Nothing is guessed beyond this table: what it
// cannot place gets area '' ("Not set") and the user chooses.
// (The per-question tag the user types on the results page is a third level, `subTopic`, shown as
// "Your tag".)

export const AREAS = {
  'Quantitative Aptitude': ['Arithmetic', 'Algebra', 'Geometry', 'Number System', 'Modern Maths'],
  VARC: ['VA', 'RC'],
  LRDI: ['DI', 'LR', 'LR based DI'],
};
export const AREA_LONG = { VA: 'Verbal Ability', RC: 'Reading Comprehension', DI: 'Data Interpretation', LR: 'Logical Reasoning', 'LR based DI': 'Logical Reasoning based Data Interpretation' };
export const NOT_SET = 'Not set';

/** Clean sub-topic names, in matching order (first match wins), with the topic each belongs to. */
const CHAPTERS = [
  ['Arithmetic', 'Mixtures & Alligations', /mixture|alligation|allegation|removal and replacement|replacement/i],
  ['Arithmetic', 'Time, Speed & Distance', /\b(dts|tsd)\b|speed|distance|\braces?\b|boats?|streams?|escalators?|circular track|\btrains?\b/i],
  ['Arithmetic', 'Time & Work', /\bwork\b|pipes?|cisterns?/i],
  ['Arithmetic', 'Simple & Compound Interest', /interest/i],
  ['Arithmetic', 'Profit & Loss', /profit|loss|discount/i],
  ['Arithmetic', 'Ratio & Proportion', /ratio|proportion|variation|partnership/i],
  ['Arithmetic', 'Percentage', /percent/i],
  ['Arithmetic', 'Averages', /average/i],
  ['Algebra', 'Linear Equations', /linear eq/i],
  ['Algebra', 'Quadratic Equations', /quadratic/i],
  ['Algebra', 'Exponents & Logarithms', /exponent|indices|surds?\b|logarithm/i],
  ['Algebra', 'Inequalities', /inequalit|modulus/i],
  ['Algebra', 'Functions', /function/i],
  ['Algebra', 'Polynomials', /polynomial/i],
  ['Geometry', 'Triangles', /triangle/i],
  ['Geometry', 'Circles', /circle/i],
  ['Geometry', 'Quadrilaterals & Polygons', /quadrilateral|polygon/i],
  ['Geometry', 'Coordinate Geometry', /coordinate/i],
  ['Geometry', 'Mensuration', /mensuration|surface area|volume|solids?\b/i],
  ['Geometry', 'Trigonometry', /trigonometr|heights? and distances?/i],
  ['Number System', 'Remainders', /remainder/i],
  ['Number System', 'Factors', /factor|divisors?\b/i],
  ['Number System', "Unit's Digit", /units?'?s?\s+digit|last digit/i],
  ['Number System', 'HCF & LCM', /\bhcf\b|\blcm\b|\bgcd\b/i],
  ['Number System', 'Divisibility', /divisib/i],
  ['Number System', 'Base System', /\bbase system|\bbases?\b/i],
  ['Modern Maths', 'Permutations & Combinations', /\bp\s*(and|&)\s*c\b|permutation|combination/i],
  ['Modern Maths', 'Probability', /probab/i],
  ['Modern Maths', 'Sequence & Series', /sequence|series|progression/i],
  ['Modern Maths', 'Set Theory', /set theory|\bsets\b/i],
  ['VA', 'Para Jumbles', /jumble|rearrang/i],
  ['VA', 'Para Summary', /summary/i],
  ['VA', 'Odd Sentence Out', /odd (sentence|one)/i],
  ['VA', 'Para Completion', /completion/i],
  ['RC', 'Reading Comprehension', /\brc\b|reading comprehension/i],
  ['DI', 'Charts & Graphs', /chart|graph|candle|bubble|scatter|\bbar\b|\bpie\b/i],
  ['DI', 'Tables', /\btables?\b/i],
  ['DI', 'Caselets', /caselet/i],
  ['LR', 'Arrangements', /arrangement|seating/i],
  ['LR', 'Games & Tournaments', /\bgames?\b|tournament/i],
  ['LR', 'Puzzles', /puzzle/i],
  ['LR', 'Venn Diagrams', /venn/i],
];

/** Topic named at the start of the file name, e.g. "Arithmetic_DPP__..." or "RC_DPP_2.pdf". */
const FILE_AREAS = [
  ['Quantitative Aptitude', 'Arithmetic', /^arithmetic/i],
  ['Quantitative Aptitude', 'Algebra', /^algebra/i],
  ['Quantitative Aptitude', 'Geometry', /^geometry/i],
  ['Quantitative Aptitude', 'Number System', /^(number[\s_-]*systems?|ns[\s_-])/i],
  ['Quantitative Aptitude', 'Modern Maths', /^(modern[\s_-]*math|mm[\s_-])/i],
  ['VARC', 'RC', /^(rc[\s_-]|reading[\s_-]*comprehension)/i],
  ['VARC', 'VA', /^(va[\s_-]|verbal[\s_-]*ability)/i],
  ['LRDI', 'DI', /^(di[\s_-]|data[\s_-]*interpretation)/i],
  ['LRDI', 'LR', /^(lr[\s_-]|logical[\s_-]*reasoning)/i],
];

export function areasOf(subject) {
  return AREAS[subject] || [];
}

/** Known clean sub-topics of a topic (for the pick-list on the review page). */
export function chaptersOf(area) {
  return CHAPTERS.filter(([a]) => a === area).map(([, c]) => c);
}

export function areaFromFileName(subject, fileName) {
  const base = String(fileName || '').trim();
  const hit = FILE_AREAS.find(([s, , re]) => s === subject && re.test(base));
  return hit ? hit[1] : null;
}

/** Raw heading name without part numbers, in normal capitals ("PERCENTAGES 2" -> "Percentages"). */
export function cleanTopicName(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*[-–:]?\s*(part\s*)?(\d+|[ivx]+)\s*$/i, '').replace(/[\s\-–:]+$/, '').trim();
  if (t && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  return t;
}

/**
 * Topic and sub-topic for a PDF: { area, chapter } (area '' when it cannot be placed).
 * The file name decides the topic when it names one; the table decides the sub-topic (searching
 * that topic first); otherwise the heading name without part numbers is used as the sub-topic.
 */
export function classifyTopic(subject, fileName, rawTopic) {
  const areas = areasOf(subject);
  const fromFile = areaFromFileName(subject, fileName);
  const raw = String(rawTopic || '');
  const inSubject = CHAPTERS.filter(([a]) => areas.includes(a));
  const hit = (fromFile && inSubject.find(([a, , re]) => a === fromFile && re.test(raw))) || inSubject.find(([, , re]) => re.test(raw));
  const area = fromFile || (hit ? hit[0] : '');
  const chapter = hit ? hit[1] : cleanTopicName(raw);
  return { area, chapter };
}

export const areaLabel = (area) => area || NOT_SET;
export const chapterLabel = (chapter) => chapter || NOT_SET;
/** One key per topic + sub-topic pair (used by filters and the sectional builder). */
export const groupKey = (q) => `${q.area || ''}|${q.chapter || ''}`;
export const groupLabel = (q) => `${areaLabel(q.area)} › ${chapterLabel(q.chapter)}`;

/** Library route of a DPP's topic: #/library/<section>/<topic>; an empty topic is the "Not set" card. */
export const NOT_SET_KEY = 'not-set';
export const sectionKey = (subject) => (subject === 'VARC' ? 'varc' : subject === 'LRDI' ? 'lrdi' : 'quant');
export const topicHref = (subject, area) => `#/library/${sectionKey(subject)}/${area ? encodeURIComponent(area) : NOT_SET_KEY}`;
