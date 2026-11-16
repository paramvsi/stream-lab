import type { Event } from '@sl/engine';
import { AppError } from '@sl/errors';

/**
 * DATA-02 storage: an uploaded file's typed rows live in OPFS (ARCHITECTURE: "OPFS for uploaded files"), one file
 * per pipeline and Source, one JSON row per line. Rows are written and read in chunks, so a 200 MB upload never
 * becomes one giant string (V8 caps strings near 512 MB). The pipeline JSON records only the file name and count.
 */
async function dir(pipelineId: string, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const uploads = await root.getDirectoryHandle('uploads', { create });
  return uploads.getDirectoryHandle(pipelineId, { create });
}

const CHUNK = 5000;

/** Storage failures in catalog terms: quota → STORE-FULL, anything else → STORE-BLOCKED. */
async function storeError(e: unknown): Promise<AppError> {
  if ((e as { name?: string } | null)?.name !== 'QuotaExceededError')
    return new AppError('STORE-BLOCKED', {}, e);
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const mb = (b?: number) => `${Math.round((b ?? 0) / 1e6)} MB`;
  return new AppError(
    'STORE-FULL',
    { used: est?.quota ? `${mb(est.usage)} of ${mb(est.quota)} used` : 'no space left' },
    e,
  );
}

/** Throws an AppError (STORE-FULL / STORE-BLOCKED) when the rows can't be stored. */
export async function saveRows(pipelineId: string, sourceId: string, rows: Event[]): Promise<void> {
  try {
    const f = await (await dir(pipelineId, true)).getFileHandle(`${sourceId}.jsonl`, { create: true });
    const w = await f.createWritable();
    for (let i = 0; i < rows.length; i += CHUNK)
      await w.write(
        rows
          .slice(i, i + CHUNK)
          .map((r) => JSON.stringify(r) + '\n')
          .join(''),
      );
    await w.close();
  } catch (e) {
    throw await storeError(e);
  }
}

/**
 * Null when the rows are gone (imported pipeline, cleared site data) or unreadable: the caller says so.
 * `limit`: stop after that many rows (the preview needs 5–50, not the whole file).
 */
export async function loadRows(
  pipelineId: string,
  sourceId: string,
  limit = Infinity,
): Promise<Event[] | null> {
  let file: File;
  try {
    file = await (await (await dir(pipelineId, false)).getFileHandle(`${sourceId}.jsonl`)).getFile();
  } catch {
    return null;
  }
  const rows: Event[] = [];
  const reader = file.stream().getReader();
  const dec = new TextDecoder();
  let rest = '';
  for (;;) {
    const r = await reader.read();
    const text = rest + (r.done ? dec.decode() : dec.decode(r.value, { stream: true }));
    const lines = text.split('\n');
    rest = r.done ? '' : lines.pop()!;
    try {
      for (const l of lines) if (l) rows.push(JSON.parse(l) as Event);
    } catch {
      return null; // a corrupt stored file reads as gone (DATA-UPLOAD-UNUSED), never a crash
    }
    if (rows.length >= limit) {
      void reader.cancel();
      return rows.slice(0, limit);
    }
    if (r.done) return rows;
  }
}

/** Whether a Source's rows are stored (no read). */
export async function hasRows(pipelineId: string, sourceId: string): Promise<boolean> {
  try {
    await (await dir(pipelineId, false)).getFileHandle(`${sourceId}.jsonl`);
    return true;
  } catch {
    return false;
  }
}

/**
 * A copied pipeline keeps its uploads (MyPipelines "Duplicate", "Keep a copy"). Missing ones are skipped; a
 * storage failure throws (STORE-FULL / STORE-BLOCKED) so the caller can say so before saving the copy.
 */
export async function copyUploads(fromId: string, toId: string, sourceIds: string[]): Promise<void> {
  for (const s of sourceIds) {
    const rows = await loadRows(fromId, s);
    if (rows) await saveRows(toId, s, rows);
  }
}

const DELETED = '.deleted';
/** Deleted uploads stay this long, so Undo and another tab's "Keep a copy" can still use them. */
export const UPLOAD_GRACE_MS = 10 * 60_000;

async function uploadsRoot() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle('uploads');
}

/** Deleting a pipeline marks its uploads; they are freed by purgeDeletedUploads after the grace period. */
export async function deleteUploads(pipelineId: string): Promise<void> {
  let d: FileSystemDirectoryHandle;
  try {
    d = await dir(pipelineId, false);
  } catch {
    return; // no uploads for this pipeline: nothing to mark
  }
  try {
    const f = await d.getFileHandle(DELETED, { create: true });
    const w = await f.createWritable();
    await w.write(String(Date.now()));
    await w.close();
  } catch {
    // The marker can't be written (storage full). The rows stay, so Undo and another tab's "Keep a copy" still
    // work; an empty marker would read as "deleted long ago", so it is removed. purgeDeletedUploads marks the
    // rows later as orphans.
    await d.removeEntry(DELETED).catch(() => undefined); // never created, or already gone
  }
}

/** Undo of a delete: the uploads are kept. */
export async function restoreUploads(pipelineId: string): Promise<void> {
  try {
    await (await dir(pipelineId, false)).removeEntry(DELETED);
  } catch {
    // never marked (no uploads): nothing to restore
  }
}

/** Frees uploads deleted longer ago than the grace period (called when My pipelines opens). */
let purging: Promise<void> | null = null;
/**
 * Frees uploads deleted longer ago than the grace period; marks orphans (rows of pipelines that no longer exist,
 * when their delete could not mark them); unmarks rows of a pipeline that exists again. One pass at a time.
 */
export function purgeDeletedUploads(
  /** Pipelines that exist now. */
  existing: Set<string>,
  now = Date.now(),
): Promise<void> {
  purging ??= purgePass(existing, now).finally(() => {
    purging = null;
  });
  return purging;
}

async function purgePass(existing: Set<string>, now: number): Promise<void> {
  let root: FileSystemDirectoryHandle;
  try {
    root = await uploadsRoot();
  } catch {
    return; // no uploads at all
  }
  const entries = (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [name, h] of entries) {
    if (h.kind !== 'directory') continue;
    const d = h as FileSystemDirectoryHandle;
    let at = NaN;
    try {
      at = Number(await (await (await d.getFileHandle(DELETED)).getFile()).text());
    } catch {
      // not marked
    }
    try {
      if (existing.has(name)) {
        // Marked but the pipeline exists (Undo, or a copy saved after a stale list): keep its rows.
        if (!Number.isNaN(at)) await d.removeEntry(DELETED);
        continue;
      }
      if (Number.isFinite(at) && at > 0) {
        if (now - at >= UPLOAD_GRACE_MS) await root.removeEntry(name, { recursive: true });
        continue;
      }
      // Unmarked rows of a pipeline that does not exist. Only rows untouched for the grace period are orphans:
      // a Duplicate or "Keep a copy" writes its rows before saving the pipeline, so fresh rows are left alone.
      let newest = 0;
      for await (const [, f] of (
        d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries())
        if (f.kind === 'file')
          newest = Math.max(newest, (await (f as FileSystemFileHandle).getFile()).lastModified);
      if (now - newest >= UPLOAD_GRACE_MS) await deleteUploads(name);
    } catch {
      // Another tab holds this folder: leave it for the next pass (housekeeping only, nothing the user asked for).
    }
  }
}

/** DATA-04: bytes of uploaded rows per pipeline (not counting ones already deleted). */
export async function uploadBytes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let root: FileSystemDirectoryHandle;
  try {
    root = await uploadsRoot();
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'NotFoundError') return out; // no uploads at all
    throw new AppError('STORE-BLOCKED', {}, e);
  }
  const dirs = (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [id, h] of dirs) {
    if (h.kind !== 'directory') continue;
    const files = (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    let bytes = 0;
    let deleted = false;
    for await (const [name, f] of files) {
      if (name === DELETED) deleted = true;
      else if (f.kind === 'file') bytes += (await (f as FileSystemFileHandle).getFile()).size;
    }
    if (!deleted && bytes) out[id] = bytes;
  }
  return out;
}

/** DATA-04 "delete uploaded data": frees a pipeline's uploads now (the pipeline stays). */
export async function removeUploads(pipelineId: string): Promise<void> {
  try {
    await (await uploadsRoot()).removeEntry(pipelineId, { recursive: true });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'NotFoundError') return; // nothing stored
    throw e; // the caller says which pipeline (DATA-DELETE-FAILED)
  }
}
