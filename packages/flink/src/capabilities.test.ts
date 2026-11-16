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

describe('audit of eb939e0', () => {
  it('a version that can not be read is "unknown", not old; odd but readable ones get their band', () => {
    expect(['', 'unknown', '<unknown>', 'Flink 2.0', 'x.y'].map(bandOf)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(['1', ' 2.3.0', 'V2.3', '2.3-rc1', '1.20-SNAPSHOT'].map(bandOf)).toEqual([
      'old',
      '2.3',
      '2.3',
      '2.3',
      '1.20',
    ]);
  });
  it("every cell is the board's (C05): one row per feature, the four bands in order", () => {
    const rows = CAPABILITIES.map((f) => [f.label, ...BANDS.map((b) => f.support[b.band])].join(' | '));
    expect(rows).toEqual([
      'Jobs, checkpoints, exceptions | yes | yes | yes | yes',
      'Stop with savepoint, drain | yes | yes | yes | yes',
      'Flame graphs | yes | yes | yes | yes',
      'Profiler | no | yes | yes | yes',
      'Rescale (adaptive scheduler) | partial | yes | yes | yes',
      'Applications tab | no | no | no | yes',
      'Rescales history | no | no | no | yes',
      'SQL Gateway REST v2 (row format) | partial | yes | yes | yes',
    ]);
  });
});
