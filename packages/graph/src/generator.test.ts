import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATOR, effectiveGenerator, generatorIssues } from './index';

describe('DATA-01 · GEN-INVALID', () => {
  it('the defaults are valid', () => {
    expect(generatorIssues(DEFAULT_GENERATOR)).toEqual([]);
  });
  it('rate ≤ 0 and late % > 100 are invalid, with a reason per field (catalog trigger)', () => {
    expect(generatorIssues({ ...DEFAULT_GENERATOR, rate: 0, latePct: 120 })).toEqual([
      { field: 'rate', reason: 'Rate must be at least 1' },
      { field: 'latePct', reason: 'Late must be at most 100 %' },
    ]);
  });
  it('fractions and huge counts are invalid', () => {
    expect(
      generatorIssues({ ...DEFAULT_GENERATOR, count: 2_000_000, keys: 2.5 }).map((i) => i.reason),
    ).toEqual(['Events must be at most 1,000,000', 'Distinct cards must be a whole number']);
  });
});

describe('data audit · generator settings', () => {
  it('#5 messages name the real limits; percentages may be fractions; % on both ends', async () => {
    const { generatorIssues: gi } = await import('./index');
    const reasons = (g: object) => gi({ ...DEFAULT_GENERATOR, ...g }).map((i) => i.reason);
    expect(reasons({ keys: 1e20 })).toEqual(['Distinct cards must be at most 1,000,000']);
    expect(reasons({ outOfOrderPct: NaN })).toEqual(['Enter a number for Out of order']);
    expect(reasons({ outOfOrderPct: 0.5 })).toEqual([]);
    expect(reasons({ duplicatePct: -1 })).toEqual(['Duplicates must be at least 0 %']);
    expect(reasons({ rate: 2.5 })).toEqual(['Rate must be a whole number']);
  });
  it('#6 the seed is 0 to 4,294,967,295 (two seeds never give the same run)', async () => {
    const { generatorIssues: gi } = await import('./index');
    expect(gi({ ...DEFAULT_GENERATOR, seed: -1 }).map((i) => i.reason)).toEqual(['Seed must be at least 0']);
    expect(gi({ ...DEFAULT_GENERATOR, seed: 2 ** 32 }).map((i) => i.reason)).toEqual([
      'Seed must be at most 4,294,967,295',
    ]);
  });
  it('#1 the drawer and the run read the same settings: invalid stored values fall back field by field', async () => {
    const { effectiveGenerator } = await import('./index');
    expect(effectiveGenerator({ count: 150, rate: 0, junk: true }, 7)).toEqual({
      ...DEFAULT_GENERATOR,
      count: 150,
      seed: 7,
    });
  });
  it('#1 importing a pipeline with a bad generator is refused with a reason', async () => {
    const { newPipeline, parsePipeline } = await import('./index');
    const p = { ...newPipeline('p_1', 'x'), data: { refTables: [], generator: { count: 1e9, rate: -5 } } };
    const r = parsePipeline(JSON.stringify(p), 'x.json');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('generator');
  });
});

describe('DATA-05 key skew and fraud patterns (board W12)', () => {
  it('defaults: no skew, no patterns (older pipelines run exactly as before)', () => {
    expect(effectiveGenerator({}, 42)).toMatchObject({
      skewPct: 0,
      patterns: { burst: false, blocklisted: false },
    });
  });
  it('key skew is a percentage (GEN-INVALID past 100); bad stored patterns fall back to off', () => {
    expect(generatorIssues({ ...DEFAULT_GENERATOR, skewPct: 120 })).toEqual([
      { field: 'skewPct', reason: 'Key skew must be at most 100 %' },
    ]);
    expect(effectiveGenerator({ patterns: { burst: 'yes', blocklisted: true } }, 1).patterns).toEqual({
      burst: false,
      blocklisted: true,
    });
  });
});
