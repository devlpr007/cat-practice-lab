// Global defaults (time limit and marks) used for every new test; editable on the Settings page.
import { getSetting, setSetting } from './db.js';
import { DEFAULT_SETTINGS, settingsProblems } from './test-record.js';

export async function getDefaults() {
  const saved = await getSetting('defaults', null);
  if (!saved || settingsProblems(saved).length) return structuredClone(DEFAULT_SETTINGS);
  return saved;
}

export async function saveDefaults(values) {
  const problems = settingsProblems(values);
  if (problems.length) throw new Error(problems.join(' '));
  const clean = {
    timeLimitMin: Number(values.timeLimitMin),
    marking: {
      mcq: { correct: Number(values.marking.mcq.correct), wrong: Number(values.marking.mcq.wrong) },
      tita: { correct: Number(values.marking.tita.correct), wrong: Number(values.marking.tita.wrong) },
    },
  };
  await setSetting('defaults', clean);
  return clean;
}
