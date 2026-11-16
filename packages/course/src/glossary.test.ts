import { describe, expect, it } from 'vitest';
import { CHAPTERS } from './chapters';
import { searchTerms, TERMS, termById } from './glossary';

describe('LEARN-04 glossary', () => {
  it('search covers names and aliases, names first; nothing found is an empty list', () => {
    expect(searchTerms('water').map((t) => t.id)).toEqual(['watermark']);
    expect(searchTerms('PROCTIME').map((t) => t.id)).toEqual(['processing-time']);
    expect(searchTerms('snapshot').map((t) => t.id)).toEqual(['checkpoint']);
    expect(searchTerms('zzz')).toEqual([]);
    expect(searchTerms('  ')).toHaveLength(TERMS.length);
  });
  it('every related term and chapter exists; ids are unique; sorted A–Z', () => {
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
    for (const t of TERMS) {
      for (const r of t.related) expect(termById(r), `${t.id} → ${r}`).toBeDefined();
      if (t.chapter)
        expect(
          CHAPTERS.some((c) => c.id === t.chapter),
          t.chapter,
        ).toBe(true);
    }
    expect(TERMS.map((t) => t.name)).toEqual([...TERMS.map((t) => t.name)].sort());
  });
});

describe('LEARN-04 concept links in the chapters', () => {
  it('every [[term|words]] link points at a glossary term', async () => {
    const { CONTENT } = await import('./outlines');
    const links = Object.values(CONTENT).flatMap((c) =>
      c.sections.flatMap((s) =>
        s.points.flatMap((p) => [...p.matchAll(/\[\[([a-z-]+)\|/g)].map((m) => m[1]!)),
      ),
    );
    expect(links.length).toBeGreaterThan(0);
    // Every "[[" is a link the parser reads (a malformed one would show as raw brackets).
    const opened = Object.values(CONTENT).flatMap((c) =>
      c.sections.flatMap((s) => s.points.flatMap((p) => p.split('[[').length - 1)),
    );
    expect(opened.reduce((a, b) => a + b, 0)).toBe(links.length);
    for (const id of links) expect(termById(id), id).toBeDefined();
  });
});
