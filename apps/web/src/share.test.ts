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
    // Built by hand: encodeShare itself refuses this size (SHARE-TOO-LONG).
    const json = new TextEncoder().encode(
      JSON.stringify({ pipeline: { ...p, name: 'x'.repeat(40 * 1024 * 1024) } }),
    );
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    void w.write(json);
    void w.close();
    const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const link = `1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    await expect(decodeShare(link)).rejects.toMatchObject({ code: 'SHARE-BROKEN' });
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

describe('EXP-04 shared view audit (be4ce5b)', () => {
  it('#1 a rows key that is not a plain node id (x/y) is SHARE-BROKEN, not a storage error later', async () => {
    const up = { ...p, data: { ...p.data, uploads: { 'x/y': { file: 'a.csv', rows: 1 } } } };
    await expect(decodeShare(await encodeShare(up, { 'x/y': [{ a: 1 }] }))).rejects.toMatchObject({
      code: 'SHARE-BROKEN',
    });
  });
  it('#3 a pipeline too big to open as a link is SHARE-TOO-LONG when making it, not SHARE-BROKEN when opening it', async () => {
    const huge = { ...p, name: 'x'.repeat(40 * 1024 * 1024) };
    await expect(encodeShare(huge)).rejects.toMatchObject({ code: 'SHARE-TOO-LONG' });
  });
});
