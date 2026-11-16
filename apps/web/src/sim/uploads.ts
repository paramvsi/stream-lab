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

/** Null when the rows are gone (copied or imported pipeline, cleared site data): the caller says so. */
export async function loadRows(pipelineId: string, sourceId: string): Promise<Event[] | null> {
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
    for (const l of lines) if (l) rows.push(JSON.parse(l) as Event);
    if (r.done) return rows;
  }
}

/** A copied pipeline keeps its uploads (MyPipelines "Duplicate", "Keep a copy"). Missing ones are skipped. */
export async function copyUploads(fromId: string, toId: string, sourceIds: string[]): Promise<void> {
  for (const s of sourceIds) {
    const rows = await loadRows(fromId, s);
    if (rows) await saveRows(toId, s, rows).catch(() => undefined);
  }
}

/** Deleting a pipeline frees its uploads (otherwise invisible space). */
export async function deleteUploads(pipelineId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const uploads = await root.getDirectoryHandle('uploads');
    await uploads.removeEntry(pipelineId, { recursive: true });
  } catch {
    // nothing stored for it, or OPFS unavailable: nothing to free
  }
}
