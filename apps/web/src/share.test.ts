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
    const back = await decodeShare(data);
    expect(back.name).toBe('Card fraud check');
    expect(back.nodes).toEqual(p.nodes);
    expect(shareUrl('https://x.test/app/', data)).toBe(`https://x.test/app/#/s/${data}`);
  });
  it('SHARE-BROKEN: a damaged, cut or foreign link is refused with the catalog code', async () => {
    const data = await encodeShare(p);
    for (const bad of [data.slice(0, data.length - 6), '1.!!!', '2.' + data.slice(2), 'nonsense', ''])
      await expect(decodeShare(bad)).rejects.toMatchObject({ code: 'SHARE-BROKEN' });
  });
  it('SHARE-TOO-LONG is about 8,000 characters', () => {
    expect(SHARE_WARN_AT).toBe(8000);
  });
});
