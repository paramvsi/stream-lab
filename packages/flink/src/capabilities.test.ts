import { describe, expect, it } from 'vitest';
import { bandOf, BANDS, CAPABILITIES } from './capabilities';

describe('CONN-07 version capabilities (board C05)', () => {
  it('reads the band of a version: older than 1.20, 1.20, 2.0–2.2, 2.3+', () => {
    expect(
      ['1.18.1', '1.19.2', 'v1.20.1', '1.20.0-SNAPSHOT', '2.0.0', '2.2.9', '2.3.0', '2.10.1', '3.0.0'].map(
        bandOf,
      ),
    ).toEqual(['old', 'old', '1.20', '1.20', '2.0', '2.0', '2.3', '2.3', '2.3']);
  });
  it('every feature has a word for every band; Applications only from 2.3 (FLINK_API: hide below 2.3)', () => {
    for (const f of CAPABILITIES)
      for (const b of BANDS) expect(['yes', 'partial', 'no']).toContain(f.support[b.band]);
    expect(CAPABILITIES.find((f) => f.id === 'applications')!.support).toEqual({
      old: 'no',
      '1.20': 'no',
      '2.0': 'no',
      '2.3': 'yes',
    });
  });
});
