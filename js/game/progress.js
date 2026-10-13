// Stage 6 (first version, from the user's brainstorm): samurai-game progress, CALCULATED from the
// saved attempts every time (rule: no separate game save that a backup could miss).
// Pure code, unit-tested in Node. Every number shown in the game can be traced to real answers.
//
// Inputs: questions, attempts, records (questionAttempts), tests, now (ms), catExamDate (setting).
import { SLOW_MS } from '../results.js';

export const DOJOS = [
  { key: 'quant', subject: 'Quantitative Aptitude', name: 'Dojo of the Blade', way: 'Way of the Blade', powerName: 'Blade Sharpness', enemy: 'Number Oni' },
  { key: 'varc', subject: 'VARC', name: 'Dojo of the Scroll', way: 'Way of the Scroll', powerName: 'Ink Mastery', enemy: 'Ink Spirits' },
  { key: 'lrdi', subject: 'LRDI', name: 'Dojo of the Shadow', way: 'Way of the Shadow', powerName: 'Shadow Strategy', enemy: 'Puzzle Masters' },
];
export const RANKS = [
  { name: 'Ashigaru', min: 0 },
  { name: 'Samurai', min: 300 },
  { name: 'Hatamoto', min: 1200 },
  { name: 'Daimyō', min: 3000 },
  { name: 'Shogun', min: 6000 },
];
/** Power: per correct answer, per Shadow Scroll cleared, per sub-topic mastered. */
export const POWER = { correct: 10, scroll: 25, mastered: 100 };
/** Battle grade from accuracy (%): S, A, B (the user's three grades). */
export const GRADES = [{ grade: 'S', min: 85 }, { grade: 'A', min: 65 }, { grade: 'B', min: 0 }];
/** Mastery: this accuracy or better across the last MASTERY_TESTS tests of a sub-topic. */
export const MASTERY_ACCURACY = 80;
export const MASTERY_TESTS = 3;
/** A defeated boss returns after this many days without practising its sub-topic. */
export const BOSS_RETURN_DAYS = 21;
/** Target time per question (ms): CAT pace, 40 minutes for 22 questions (VARC 24). */
export const TARGET_MS = { 'Quantitative Aptitude': Math.round(2_400_000 / 22), VARC: 100_000, LRDI: Math.round(2_400_000 / 22) };
export const DAILY_REVIEW_GOAL = 3;

const DAY = 86_400_000;
/** Local calendar day 'YYYY-MM-DD' of a time. */
export const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
/** Monday (local) of the week containing ms, as a day string. */
export const weekOf = (ms) => { const d = new Date(dayStart(ms)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d.getTime()); };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

export const gradeOf = (accuracy) => (accuracy == null ? null : GRADES.find((g) => accuracy >= g.min).grade);
export function rankOf(power) {
  let i = 0;
  while (i + 1 < RANKS.length && power >= RANKS[i + 1].min) i++;
  const next = RANKS[i + 1] || null;
  return { ...RANKS[i], index: i, next, toNext: next ? next.min - power : 0, progress: next ? (power - RANKS[i].min) / (next.min - RANKS[i].min) : 1 };
}

/**
 * Streak of practice days ending today, with one free rest day per week (Mon–Sun): a missed day is
 * forgiven if no other day of that week was forgiven. Today not practised yet does not break it.
 */
export function streakAt(days, todayMs) {
  let count = 0;
  const rested = new Set();
  let t = dayStart(todayMs);
  const first = days.size ? Math.min(...[...days].map((d) => Date.parse(`${d}T00:00:00`))) : t;
  for (let i = 0; t >= first; i++, t = addDays(t, -1)) {
    const d = dayOf(t);
    if (days.has(d)) { count++; continue; }
    if (i === 0) continue;
    const w = weekOf(t);
    if (!rested.has(w)) { rested.add(w); continue; }
    break;
  }
  return { count, restUsedThisWeek: rested.has(weekOf(todayMs)) };
}

export function bestStreak(days) {
  let best = 0;
  for (const d of days) best = Math.max(best, streakAt(days, Date.parse(`${d}T12:00:00`)).count);
  return best;
}

/** Everything the game shows. */
export function gameState({ questions, attempts, records, tests = [], now = Date.now(), catExamDate = null }) {
  const qById = new Map(questions.map((q) => [q.id, q]));
  const submitted = attempts.filter((a) => a.status === 'submitted').sort((a, b) => a.submittedAt - b.submittedAt);
  const aById = new Map(submitted.map((a) => [a.id, a]));
  const testById = new Map(tests.map((t) => [t.id, t]));
  const recs = records.filter((r) => aById.has(r.attemptId) && qById.has(r.questionId));
  const byAttempt = new Map();
  for (const r of recs) {
    if (!byAttempt.has(r.attemptId)) byAttempt.set(r.attemptId, []);
    byAttempt.get(r.attemptId).push(r);
  }

  // ---- battles (one per submitted test) ----
  const battles = submitted.filter((a) => byAttempt.has(a.id)).map((a) => {
    const list = byAttempt.get(a.id);
    const correct = list.filter((r) => r.correct === true).length;
    const wrong = list.filter((r) => r.correct === false).length;
    const subjects = new Map();
    for (const r of list) { const s = qById.get(r.questionId).subject; subjects.set(s, (subjects.get(s) || 0) + 1); }
    const subject = [...subjects.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const score = Math.round(list.reduce((s, r) => s + (typeof r.marks === 'number' ? r.marks : 0), 0) * 100) / 100;
    const accuracy = pct(correct, correct + wrong);
    return {
      attemptId: a.id, at: a.submittedAt, day: dayOf(a.submittedAt), name: a.snapshot?.name || testById.get(a.testId)?.name || 'Test',
      kind: testById.get(a.testId)?.kind || 'pdf', subject, questions: list.length, correct, wrong, score,
      maxScore: a.summary?.maxScore ?? null, damage: Math.max(0, score), accuracy, grade: gradeOf(accuracy),
    };
  });

  // ---- sub-topics: mastery and bosses ----
  const groupOf = (q) => `${q.subject}|${q.area || ''}|${q.chapter || ''}`;
  const nodes = new Map();
  for (const q of questions) {
    if ((q.area || '') === 'Mock') continue; // untagged mock questions are not a sub-topic boss
    const k = groupOf(q);
    if (!nodes.has(k)) nodes.set(k, { key: k, subject: q.subject, area: q.area || '', chapter: q.chapter || '', questions: 0, tests: [], lastAt: null });
    nodes.get(k).questions++;
  }
  for (const b of battles) {
    const answered = byAttempt.get(b.attemptId).filter((r) => r.correct === true || r.correct === false);
    const per = new Map();
    for (const r of answered) {
      if ((qById.get(r.questionId).area || '') === 'Mock') continue;
      const k = groupOf(qById.get(r.questionId));
      const p = per.get(k) || { at: b.at, answered: 0, correct: 0 };
      p.answered++;
      if (r.correct) p.correct++;
      per.set(k, p);
    }
    for (const [k, p] of per) { nodes.get(k).tests.push(p); nodes.get(k).lastAt = b.at; }
  }
  const tree = [...nodes.values()].map((n) => {
    const last = n.tests.slice(-MASTERY_TESTS);
    const answered = last.reduce((s, p) => s + p.answered, 0);
    const accuracy = pct(last.reduce((s, p) => s + p.correct, 0), answered);
    const mastered = n.tests.length >= MASTERY_TESTS && accuracy >= MASTERY_ACCURACY;
    const progress = n.tests.length ? Math.round(Math.min(1, n.tests.length / MASTERY_TESTS) * Math.min(1, (accuracy || 0) / MASTERY_ACCURACY) * 100) : 0;
    const idleDays = n.lastAt == null ? null : Math.floor((dayStart(now) - dayStart(n.lastAt)) / DAY);
    let state = n.tests.length ? (mastered ? 'mastered' : 'learning') : 'locked';
    let bossHp = 100 - progress;
    if (mastered) bossHp = 0;
    if (mastered && idleDays >= BOSS_RETURN_DAYS) {
      state = 'returned';
      bossHp = Math.min(60, 30 + 10 * Math.floor((idleDays - BOSS_RETURN_DAYS) / 7));
    }
    return { key: n.key, subject: n.subject, area: n.area, chapter: n.chapter, questions: n.questions, testsCount: n.tests.length, accuracy, progress, mastered, state, bossHp, idleDays };
  });

  // ---- Shadow Scrolls: questions answered wrong, cleared by a later right answer or re-try ----
  const byQuestion = new Map();
  for (const r of recs) {
    if (!byQuestion.has(r.questionId)) byQuestion.set(r.questionId, []);
    byQuestion.get(r.questionId).push(r);
  }
  const scrolls = [];
  for (const [qid, list] of byQuestion) {
    const events = [];
    for (const r of list) {
      const at = aById.get(r.attemptId).submittedAt;
      if (r.correct === true || r.correct === false) events.push({ at, ok: r.correct, attemptId: r.attemptId, how: 'test' });
      for (const x of r.reattempts || []) events.push({ at: x.at, ok: !!x.correct, attemptId: r.attemptId, how: 'retry' });
    }
    events.sort((a, b) => a.at - b.at);
    const firstWrong = events.findIndex((e) => !e.ok);
    if (firstWrong < 0) continue;
    const lastWrong = events.map((e) => e.ok).lastIndexOf(false);
    const clearedBy = events.slice(lastWrong + 1).find((e) => e.ok) || null;
    const q = qById.get(qid);
    scrolls.push({
      questionId: qid, subject: q.subject, area: q.area || '', chapter: q.chapter || '', sourceId: q.sourceId, n: q.n,
      since: events[firstWrong].at, cleared: !!clearedBy, clearedAt: clearedBy?.at ?? null, clearedHow: clearedBy?.how ?? null,
      attemptId: events[lastWrong].attemptId,
    });
  }
  scrolls.sort((a, b) => (a.cleared - b.cleared) || b.since - a.since);

  // ---- powers per dojo and rank ----
  const correctBy = new Map();
  for (const r of recs) if (r.correct === true) { const s = qById.get(r.questionId).subject; correctBy.set(s, (correctBy.get(s) || 0) + 1); }
  const dojos = DOJOS.map((d) => {
    const correct = correctBy.get(d.subject) || 0;
    const cleared = scrolls.filter((s) => s.subject === d.subject && s.cleared).length;
    const mastered = tree.filter((n) => n.subject === d.subject && n.mastered).length;
    const subjectRecs = recs.filter((r) => qById.get(r.questionId).subject === d.subject && (r.correct === true || r.correct === false));
    const avgMs = subjectRecs.length ? Math.round(subjectRecs.reduce((s, r) => s + (r.timeSpentMs || 0), 0) / subjectRecs.length) : null;
    return {
      ...d, correct, scrollsCleared: cleared, scrollsOpen: scrolls.filter((s) => s.subject === d.subject && !s.cleared).length, mastered,
      power: correct * POWER.correct + cleared * POWER.scroll + mastered * POWER.mastered,
      battles: battles.filter((b) => b.subject === d.subject).length,
      bossesDefeated: tree.filter((n) => n.subject === d.subject && n.state === 'mastered').length,
      bossesReturned: tree.filter((n) => n.subject === d.subject && n.state === 'returned').length,
      avgMs, targetMs: TARGET_MS[d.subject], slowCorrect: subjectRecs.filter((r) => r.correct === true && r.timeSpentMs > SLOW_MS).length,
    };
  });
  const power = dojos.reduce((s, d) => s + d.power, 0);

  // ---- days, streak, daily quest, weekly and final boss ----
  const practiceDays = new Set(battles.map((b) => b.day));
  const answeredPerDay = new Map();
  for (const b of battles) answeredPerDay.set(b.day, (answeredPerDay.get(b.day) || 0) + b.correct + b.wrong);
  const today = dayOf(now);
  const streak = streakAt(practiceDays, now);
  let reviewedToday = 0;
  for (const r of recs) {
    reviewedToday += (r.reattempts || []).filter((x) => dayOf(x.at) === today).length;
    if (r.mistakeReason?.at && dayOf(r.mistakeReason.at) === today) reviewedToday++;
  }
  const dppToday = battles.some((b) => b.day === today);
  const thisWeek = weekOf(now);
  const weekly = battles.filter((b) => b.kind === 'custom' && weekOf(b.at) === thisWeek && b.questions >= 10);
  const weeklyBest = weekly.sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0] || null;
  const examMs = catExamDate ? Date.parse(`${catExamDate}T00:00:00`) : null;

  const sGrades = battles.filter((b) => b.grade === 'S').length;
  const bestBattle = battles.filter((b) => b.correct + b.wrong >= 10).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0) || b.score - a.score)[0] || null;
  const best = {
    accuracy: bestBattle,
    streak: bestStreak(practiceDays),
    dayQuestions: Math.max(0, ...answeredPerDay.values()),
    sGrades,
    bossesDefeated: tree.filter((n) => n.state === 'mastered').length,
    scrollsCleared: scrolls.filter((s) => s.cleared).length,
  };
  const rank = rankOf(power);
  const unlocks = [
    ...RANKS.map((r) => ({ id: `title-${r.name}`, kind: 'title', name: r.name, how: `Reach ${r.min} power`, unlocked: power >= r.min })),
    { id: 'lantern', kind: 'decoration', name: 'Paper lantern', how: 'A 7-day practice streak', unlocked: best.streak >= 7 },
    { id: 'katana-crimson', kind: 'katana', name: 'Crimson katana', how: 'Earn 10 S grades', unlocked: sGrades >= 10 },
    { id: 'crest', kind: 'decoration', name: 'Golden crest', how: 'Defeat 5 topic bosses', unlocked: best.bossesDefeated >= 5 },
    { id: 'moon', kind: 'decoration', name: 'Silver moon', how: 'Clear 20 Shadow Scrolls', unlocked: best.scrollsCleared >= 20 },
    { id: 'brush', kind: 'decoration', name: 'Ink brush', how: 'Practise on 30 different days', unlocked: practiceDays.size >= 30 },
  ];

  return {
    battles, tree, scrolls, dojos, power, rank, unlocks, best,
    days: { practiced: practiceDays, answeredPerDay, count: practiceDays.size },
    streak: { ...streak, best: best.streak },
    daily: { dppDone: dppToday, reviewed: reviewedToday, reviewGoal: DAILY_REVIEW_GOAL, complete: dppToday && reviewedToday >= DAILY_REVIEW_GOAL },
    weeklyBoss: { week: thisWeek, fought: weekly.length > 0, defeated: !!weeklyBest && weeklyBest.accuracy >= 60, best: weeklyBest },
    finalBoss: { date: catExamDate, daysLeft: examMs == null ? null : Math.ceil((examMs - dayStart(now)) / DAY) },
  };
}
