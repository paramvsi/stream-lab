import { AppError } from '@sl/errors';
import type { Event } from '@sl/engine';
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

/** Uploaded rows per Source id, when "Include uploaded data" is on. */
export type SharedRows = Record<string, Event[]>;

export async function encodeShare(p: Pipeline, rows?: SharedRows): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(rows ? { pipeline: p, rows } : { pipeline: p }));
  return `${VERSION}.${b64url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/** Throws AppError SHARE-BROKEN for anything that is not a whole, valid pipeline from this format. */
export async function decodeShare(data: string): Promise<{ pipeline: Pipeline; rows?: SharedRows }> {
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
  let payload: { pipeline?: unknown; rows?: unknown };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch (e) {
    throw broken(e);
  }
  const r = parsePipeline(payload?.pipeline, 'shared link');
  if (!r.ok) throw broken(r.issue);
  const rows = payload.rows;
  if (rows === undefined) return { pipeline: r.pipeline };
  // Rows only for the pipeline's uploaded Sources, each a list of plain objects.
  const ok =
    rows !== null &&
    typeof rows === 'object' &&
    Object.entries(rows).every(
      ([id, list]) =>
        r.pipeline.data.uploads?.[id] !== undefined &&
        Array.isArray(list) &&
        list.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x)),
    );
  if (!ok) throw broken();
  return { pipeline: r.pipeline, rows: rows as SharedRows };
}

/** A pipeline as a JSON file (W18 / WX05 "Export JSON", STORE-BLOCKED "Export now"). */
export function downloadJson(p: Pipeline) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'pipeline'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export const shareUrl = (base: string, data: string) => `${base.replace(/#.*$/, '')}#/s/${data}`;
