import { newPipeline } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, shareUrl, SHARE_WARN_AT } from './share';

const p = {
  ...newPipeline('p_1', 'Card fraud check'),
  nodes: [{ id: 'g', type: 'Generator' as const, position: { x: 0, y: 0 }, config: {} }],
};

describe('EXP-04 share link', () => {
  it('round-trips a pipeline through the URL hash (compressed, versioned)', async () => {
    const data = await encodeShare(p);
    expect(data).toMatch(/^1\.[A-Za-z0-9_-]+$/); // URL-safe, no padding
    const { pipeline: back, rows } = await decodeShare(data);
    expect(back.name).toBe('Card fraud check');
    expect(back.nodes).toEqual(p.nodes);
    expect(rows).toBeUndefined();
    expect(shareUrl('https://x.test/app/', data)).toBe(`https://x.test/app/#/s/${data}`);
  });
  it('SHARE-BROKEN: a damaged, cut or foreign link is refused with the catalog code', async () => {
    const data = await encodeShare(p);
    for (const bad of [data.slice(0, data.length - 6), '1.!!!', '2.' + data.slice(2), 'nonsense', ''])
      await expect(decodeShare(bad)).rejects.toMatchObject({ code: 'SHARE-BROKEN' });
  });
  it("uploaded rows travel too when asked, only for the pipeline's uploaded Sources", async () => {
    const up = { ...p, data: { ...p.data, uploads: { g: { file: 'pay.csv', rows: 2 } } } };
    const rows = { g: [{ a: 1 }, { a: 2 }] };
    expect((await decodeShare(await encodeShare(up, rows))).rows).toEqual(rows);
    await expect(decodeShare(await encodeShare(up, { other: [{ a: 1 }] }))).rejects.toMatchObject({
      code: 'SHARE-BROKEN',
    });
    await expect(decodeShare(await encodeShare(up, { g: [1, 2] as never }))).rejects.toMatchObject({
      code: 'SHARE-BROKEN',
    });
  });
  it('SHARE-TOO-LONG is about 8,000 characters', () => {
    expect(SHARE_WARN_AT).toBe(8000);
  });
});

describe('EXP-04 share audit (ff0aa65)', () => {
  it('#4 a link that expands to more than the cap is SHARE-BROKEN, not decoded into memory', async () => {
    const huge = { ...p, name: 'x'.repeat(40 * 1024 * 1024) };
    await expect(decodeShare(await encodeShare(huge))).rejects.toMatchObject({ code: 'SHARE-BROKEN' });
  });
  it("#10 rows must be an object keyed by the pipeline's own uploaded Sources", async () => {
    const up = { ...p, data: { ...p.data, uploads: { g: { file: 'pay.csv', rows: 1 } } } };
    await expect(decodeShare(await encodeShare(up, [] as never))).rejects.toMatchObject({
      code: 'SHARE-BROKEN',
    });
    await expect(decodeShare(await encodeShare(up, { toString: [{}] } as never))).rejects.toMatchObject({
      code: 'SHARE-BROKEN',
    });
  });
});
