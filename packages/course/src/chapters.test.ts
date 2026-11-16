import { describe, expect, it } from 'vitest';
import { CHAPTERS, nextChapter } from './chapters';

describe('LEARN-05 chapters', () => {
  it('ten, in the order of LEARN-05; 1–6 open (MVP), 7–10 v1', () => {
    expect(CHAPTERS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(CHAPTERS.filter((c) => !c.v1).map((c) => c.id)).toEqual([
      'event-time',
      'watermarks',
      'windows',
      'aggregations',
      'deduplication',
      'joins',
    ]);
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(10);
  });
  it('the next chapter is the first open one not done; none when 1–6 are done', () => {
    expect(nextChapter({})?.id).toBe('event-time');
    expect(nextChapter({ 'event-time': 'done', watermarks: 'done', windows: 'started' })?.id).toBe('windows');
    expect(nextChapter(Object.fromEntries(CHAPTERS.slice(0, 6).map((c) => [c.id, 'done'])))).toBeUndefined();
  });
});

describe('LEARN-03 challenges', () => {
  it('every open chapter has content and a challenge whose answers point at an option', async () => {
    const { CONTENT } = await import('./outlines');
    for (const c of CHAPTERS.filter((x) => !x.v1)) {
      const k = CONTENT[c.id];
      expect(k, c.id).toBeDefined();
      expect(k!.challenge.length).toBeGreaterThan(0);
      for (const q of k!.challenge) expect(q.options[q.answer], q.q).toBeDefined();
    }
  });
  it('a right answer passes; a wrong one fails with the hint (COURSE-WRONG)', async () => {
    const { check } = await import('./check');
    const q = { q: '?', options: ['a', 'b'], answer: 1, hint: 'look at b', why: 'b' };
    expect(check(q, 1)).toEqual({ pass: true });
    expect(check(q, 0)).toEqual({ pass: false, hint: 'look at b' });
  });
});
