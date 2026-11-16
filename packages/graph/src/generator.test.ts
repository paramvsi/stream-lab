import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATOR, generatorIssues } from './index';

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
