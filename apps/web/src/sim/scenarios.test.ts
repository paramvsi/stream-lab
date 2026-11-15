import { parsePipeline, validate } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { fromScenario, SCENARIOS } from './scenarios';

describe('SIM-01 · scenario gallery', () => {
  it('has blank plus the five fintech scenarios of SIM-01', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'blank',
      'fraud-bursts',
      'refund-matching',
      'card-velocity',
      'merchant-top-n',
      'late-payments',
    ]);
  });

  it.each(SCENARIOS.filter((s) => s.id !== 'blank'))(
    '$id imports cleanly and validates with no problems',
    (s) => {
      const p = fromScenario(s, `p_${s.id}`);
      const r = parsePipeline(JSON.parse(JSON.stringify(p)), `${s.id}.json`);
      expect(r.ok ? 'ok' : r.issue.params.reason).toBe('ok');
      expect(validate(p).map((i) => `${i.code} ${JSON.stringify(i.params)}`)).toEqual([]);
    },
  );

  it('blank is the W09 empty canvas', () => {
    const p = fromScenario(SCENARIOS[0]!, 'p_blank');
    expect(p.name).toBe('Untitled pipeline');
    expect(p.nodes).toEqual([]);
    expect(validate(p).map((i) => i.code)).toEqual(['SIM-NO-SOURCE']);
  });
});
