import type { Question } from './outlines';

/** LEARN-03: a challenge answer is a pass, or a fail with the question's hint (COURSE-WRONG {hint}). */
export function check(q: Question, choice: number): { pass: true } | { pass: false; hint: string } {
  return choice === q.answer ? { pass: true } : { pass: false, hint: q.hint };
}
