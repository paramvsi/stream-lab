import { AppError } from '@sl/errors';
import { parsePipeline, type Pipeline } from '@sl/graph';

/**
 * EXP-04 share link: the whole pipeline travels in the URL hash, compressed (deflate-raw, the browser's own
 * CompressionStream) and base64url-encoded, behind a format version ("1."). No server sees it.
 * The link is `<site>/#/s/<data>`: the site routes on the hash (static hosting, no rewrites), so the board's
 * `/s#<data>` becomes `#/s/<data>` (MORNING D51).
 */
export const SHARE_WARN_AT = 8000; // SHARE-TOO-LONG: "some apps cut links over 8,000"
const VERSION = '1';

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  // Write and close without waiting: the readable side must be read at the same time (backpressure).
  w.write(new Uint8Array(bytes) as Uint8Array<ArrayBuffer>).catch(() => undefined); // the read below reports it
  w.close().catch(() => undefined);
  return new Uint8Array(await new Response(t.readable).arrayBuffer());
}
const b64url = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export async function encodeShare(p: Pipeline): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(p));
  return `${VERSION}.${b64url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/** Throws AppError SHARE-BROKEN for anything that is not a whole, valid pipeline from this format. */
export async function decodeShare(data: string): Promise<Pipeline> {
  const broken = (cause?: unknown) => new AppError('SHARE-BROKEN', {}, cause);
  const [v, body] = [data.slice(0, data.indexOf('.')), data.slice(data.indexOf('.') + 1)];
  if (v !== VERSION || !body || !/^[A-Za-z0-9_-]+$/.test(body)) throw broken();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      await pipe(unb64url(body), new DecompressionStream('deflate-raw')),
    );
  } catch (e) {
    throw broken(e); // cut or damaged: the stream ends early or the bytes are not deflate
  }
  const r = parsePipeline(text, 'shared link');
  if (!r.ok) throw broken(r.issue);
  return r.pipeline;
}

export const shareUrl = (base: string, data: string) => `${base.replace(/#.*$/, '')}#/s/${data}`;
