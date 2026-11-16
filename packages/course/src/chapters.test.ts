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
