import { AppError } from '@sl/errors';
import type { ChapterStatus, Progress } from '@sl/course';
import type { BuiltinTable } from '@sl/engine';
import type { Pipeline } from '@sl/graph';
import { openDB, type IDBPDatabase } from 'idb';
import { deleteUploads } from './sim/uploads';

/** ARCHITECTURE.md § Website data flow: IndexedDB `pipelines` (versioned JSON), BroadcastChannel `streamlab`. */
const DB = 'streamlab';
const VERSION = 3; // 2: the `refTables` store (DATA-03); 3: `progress` (LEARN-01)

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  // Through a promise: some browsers throw synchronously from indexedDB.open (private mode); that must map too.
  dbp ??= new Promise<IDBPDatabase>((resolve, reject) => {
    let gaveUp = false;
    const opening = Promise.resolve().then(() =>
      openDB(DB, VERSION, {
        upgrade(d) {
          if (!d.objectStoreNames.contains('pipelines')) d.createObjectStore('pipelines', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('refTables'))
            d.createObjectStore('refTables', { keyPath: 'name' });
          if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress', { keyPath: 'id' });
        },
        // A tab still open on an older version holds the upgrade: say so instead of waiting forever.
        blocked() {
          gaveUp = true;
          reject(new AppError('STORE-UPGRADE-BLOCKED'));
        },
        // A newer version opening elsewhere: let it upgrade (this tab reconnects on its next call).
        blocking() {
          void dbp?.then((d) => d.close());
          dbp = null;
        },
      }),
    );
    opening.then(
      (d) => (gaveUp ? d.close() : resolve(d)), // opened after we gave up: the next call opens it again
      // A newer version is already there (this tab's code is older than another tab's): reload, not blocked.
      (e: unknown) =>
        reject(
          (e as { name?: string } | null)?.name === 'VersionError'
            ? new AppError('STORE-UPGRADE-BLOCKED', {}, e)
            : new AppError('STORE-BLOCKED', {}, e), // private mode / blocked storage
        ),
    );
  }).catch((e: unknown) => {
    dbp = null;
    throw e;
  });
  return dbp;
}

/** Map a write failure to the catalog: quota → STORE-FULL ({used} from the browser's estimate), else STORE-BLOCKED. */
async function storeError(e: unknown): Promise<AppError> {
  if (e instanceof AppError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name !== 'QuotaExceededError') return new AppError('STORE-BLOCKED', {}, e);
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const mb = (b?: number) => `${Math.round((b ?? 0) / 1e6)} MB`;
  return new AppError(
    'STORE-FULL',
    { used: est?.quota ? `${mb(est.usage)} of ${mb(est.quota)} used` : 'no space left' },
    e,
  );
}

export interface PipelineMeta {
  id: string;
  name: string;
  updatedAt: string;
  nodes: number;
  scenario: string;
}

export async function listPipelines(): Promise<PipelineMeta[]> {
  const all = (await (await db()).getAll('pipelines')) as (Pipeline & { scenario?: string })[];
  return all
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      nodes: p.nodes.length,
      scenario: p.scenario ?? 'Blank',
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPipeline(id: string): Promise<(Pipeline & { scenario?: string }) | undefined> {
  return (await db()).get('pipelines', id);
}

export async function savePipeline(p: Pipeline & { scenario?: string }): Promise<void> {
  try {
    await (await db()).put('pipelines', p);
  } catch (e) {
    throw await storeError(e);
  }
  announce({ type: 'saved', id: p.id, updatedAt: p.updatedAt, tab: TAB });
}

export async function deletePipeline(id: string): Promise<void> {
  try {
    await (await db()).delete('pipelines', id);
  } catch (e) {
    throw await storeError(e);
  }
  // Neither a rescue copy nor this tab's unsaved copy may bring a deleted pipeline back; other tabs stop saving it.
  clearRescue(id);
  void deleteUploads(id); // its uploaded rows (OPFS) are freed too
  unsaved.delete(id);
  announce({ type: 'deleted', id, tab: TAB });
}

/** Pipelines whose first save failed (storage full/blocked): open from memory, with the banner (not "Saved"). */
export const unsaved = new Map<string, Pipeline & { scenario?: string }>();

/* ---------- unload rescue (SIM-20) ---------- */

// An IndexedDB write started while the page unloads may never finish. On unload the pending change is also
// written synchronously to localStorage; the next load prefers it when newer, writes it back, and clears it.
const RESCUE = (id: string) => `streamlab:rescue:${id}`;

export function writeRescue(p: Pipeline & { scenario?: string }) {
  try {
    localStorage.setItem(RESCUE(p.id), JSON.stringify(p));
  } catch {
    // Storage blocked: nothing more can be done synchronously; the async save was also attempted.
    return false;
  }
  return true;
}

/** Read the rescue copy WITHOUT removing it; call clearRescue only once it is safely back in IndexedDB. */
export function peekRescue(id: string): (Pipeline & { scenario?: string }) | null {
  try {
    const raw = localStorage.getItem(RESCUE(id));
    return raw ? (JSON.parse(raw) as Pipeline & { scenario?: string }) : null;
  } catch {
    return null;
  }
}

export function clearRescue(id: string) {
  try {
    localStorage.removeItem(RESCUE(id));
  } catch {
    // nothing to clear when storage is blocked
  }
}

/* ---------- multi-tab (SIM-TAB-CONFLICT) ---------- */

export const TAB = Math.random().toString(36).slice(2);
export type SavedMsg =
  | { type: 'saved'; id: string; updatedAt: string; tab: string }
  | { type: 'deleted'; id: string; tab: string };

let channel: BroadcastChannel | null = null;
function chan() {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel('streamlab');
  return channel;
}
function announce(m: SavedMsg) {
  chan()?.postMessage(m);
}
/** Calls `fn` when ANOTHER tab saves or deletes pipeline `id`. */
export function onSavedElsewhere(id: string, fn: (m: SavedMsg) => void): () => void {
  const c = chan();
  if (!c) return () => {};
  const h = (e: MessageEvent<SavedMsg>) => {
    if (e.data && e.data.id === id && e.data.tab !== TAB) fn(e.data);
  };
  c.addEventListener('message', h);
  return () => c.removeEventListener('message', h);
}

/** Test hook: close and forget the cached connection (so the test can delete the database). */
export async function _resetForTests() {
  const p = dbp;
  dbp = null;
  (await p?.catch(() => null))?.close();
}

/**
 * DATA-03: imported reference tables (ARCHITECTURE: IndexedDB `refTables`), shared by every pipeline in this
 * browser. Throws STORE-* on failure (the caller keeps the form's content and says so).
 */
export async function listRefTables(): Promise<BuiltinTable[]> {
  try {
    return (await (await db()).getAll('refTables')) as BuiltinTable[];
  } catch (e) {
    throw await storeError(e);
  }
}
export async function saveRefTable(t: BuiltinTable): Promise<void> {
  try {
    await (await db()).put('refTables', t);
  } catch (e) {
    throw await storeError(e);
  }
}
export async function deleteRefTable(name: string): Promise<void> {
  try {
    await (await db()).delete('refTables', name);
  } catch (e) {
    throw await storeError(e);
  }
}

/** LEARN-01 course progress, per chapter ("Saved in this browser"). */
export async function getProgress(): Promise<Progress> {
  const all = (await (await db()).getAll('progress')) as { id: string; status: ChapterStatus }[];
  return Object.fromEntries(all.map((r) => [r.id, r.status]));
}
export async function setChapterStatus(id: string, status: ChapterStatus): Promise<void> {
  try {
    await (await db()).put('progress', { id, status });
  } catch (e) {
    throw await storeError(e);
  }
}
