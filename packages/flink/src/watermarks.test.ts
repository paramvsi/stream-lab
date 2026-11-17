import { describe, expect, it } from 'vitest';
import { getWatermarks, holdingBack } from './watermarks';

const ok = (body: unknown) => async () => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });

describe('JOB-03 · watermarks (D09b)', () => {
  it('reads one input watermark per subtask (ms), in subtask order; no metric yet or Long.MIN_VALUE is "none yet"', async () => {
    let path = '';
    const w = await getWatermarks(
      async (r) => (
        (path = r.path),
        ok([
          { id: '2.currentInputWatermark', value: '1700000006000' },
          { id: '0.currentInputWatermark', value: '-9223372036854775808' },
          { id: '1.currentInputWatermark', value: '1700000005000' },
        ])()
      ),
      'prod',
      'j 1',
      'v1',
      4,
    );
    expect(path).toBe('/jobs/j%201/vertices/v1/watermarks');
    expect(w).toEqual([
      { index: 0, at: null },
      { index: 1, at: 1700000005000 },
      { index: 2, at: 1700000006000 },
      { index: 3, at: null },
    ]);
  });

  it('holdingBack: the subtask furthest behind and by how much against the next one; none when they are close', () => {
    const at = (...ms: (number | null)[]) => ms.map((a, index) => ({ index, at: a }));
    expect(holdingBack(at(1_000, 40_000, 41_000))).toEqual({ index: 0, behindMs: 39_000 });
    expect(holdingBack(at(40_000, 41_000))).toBeNull();
    expect(holdingBack(at(1_000))).toBeNull();
    expect(holdingBack(at(1_000, null, 41_000))).toBeNull();
  });
});
