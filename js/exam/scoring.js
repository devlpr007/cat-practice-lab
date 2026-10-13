// Is an answer correct? (pure code) MCQ: same letter. TITA: same number (60 = 60.0 = 060).
import { normaliseNumber } from '../parser/validate.js';

export function isCorrect(type, given, key) {
  if (given == null || given === '' || key == null) return false;
  if (type === 'MCQ') return String(given).trim().toUpperCase() === String(key).trim().toUpperCase();
  const a = normaliseNumber(given);
  const b = normaliseNumber(key);
  return a !== null && a === b;
}
