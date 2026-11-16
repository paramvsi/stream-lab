import type { Event } from '@sl/engine';

/**
 * DATA-02 storage: an uploaded file's typed rows live in OPFS (ARCHITECTURE: "OPFS for uploaded files"), one
 * JSON file per pipeline and Source. The pipeline JSON only records the file name and row count.
 */
async function dir(pipelineId: string, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const uploads = await root.getDirectoryHandle('uploads', { create });
  return uploads.getDirectoryHandle(pipelineId, { create });
}

export async function saveRows(pipelineId: string, sourceId: string, rows: Event[]): Promise<void> {
  const f = await (await dir(pipelineId, true)).getFileHandle(`${sourceId}.json`, { create: true });
  const w = await f.createWritable();
  await w.write(JSON.stringify(rows));
  await w.close();
}

/** Null when the rows are gone (cleared site data, another browser): the Source falls back to the generator. */
export async function loadRows(pipelineId: string, sourceId: string): Promise<Event[] | null> {
  try {
    const f = await (await dir(pipelineId, false)).getFileHandle(`${sourceId}.json`);
    return JSON.parse(await (await f.getFile()).text()) as Event[];
  } catch {
    return null;
  }
}
