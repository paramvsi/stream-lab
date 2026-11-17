import 'fake-indexeddb/auto';
import { AppError } from '@sl/errors';
import { newPipeline } from '@sl/graph';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTests,
  deletePipeline,
  getPipeline,
  getProgress,
  setChapterStatus,
  listPipelines,
  onSavedElsewhere,
  savePipeline,
  TAB,
  clearRescue,
  peekRescue,
  writeRescue,
} from './storage';

beforeEach(async () => {
  await _resetForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('streamlab');
    req.onsuccess = req.onerror = req.onblocked = r;
  });
});

const p = (id: string, name: string, at: string) => ({
  ...newPipeline(id, name, new Date(at)),
  scenario: 'Fintech',
});

describe('SIM-02 / SIM-20 · storage', () => {
  it('saves, lists newest first, reads back and deletes', async () => {
    await savePipeline(p('a', 'Card bursts', '2026-11-15T10:00:00Z'));
    await savePipeline(p('b', 'Late payments', '2026-11-15T11:00:00Z'));
    expect((await listPipelines()).map((x) => x.name)).toEqual(['Late payments', 'Card bursts']);
    expect((await getPipeline('a'))?.name).toBe('Card bursts');
    await deletePipeline('a');
    expect((await listPipelines()).map((x) => x.id)).toEqual(['b']);
  });

  it('PIPELINE-DELETED-ELSEWHERE: an update of a deleted pipeline is refused, not written back (persist-audit Q1)', async () => {
    // Another tab deleted it; this tab's autosave fires before the "deleted" broadcast arrives.
    await savePipeline(p('a', 'Card bursts', '2026-11-15T10:00:00Z'));
    await deletePipeline('a');
    expect(await savePipeline(p('a', 'Card bursts', '2026-11-15T10:01:00Z'), { update: true })).toBe(false);
    expect(await getPipeline('a')).toBeUndefined();
    // A plain save (Undo of the delete, a first save) still creates it.
    expect(await savePipeline(p('a', 'Card bursts', '2026-11-15T10:02:00Z'))).toBe(true);
    expect((await getPipeline('a'))?.updatedAt).toBe('2026-11-15T10:02:00.000Z');
  });

  it('list reports size and scenario for the table', async () => {
    await savePipeline({
      ...p('a', 'x', '2026-11-15T10:00:00Z'),
      nodes: [{ id: 'n', type: 'Source', position: { x: 0, y: 0 }, config: {} }],
    });
    expect((await listPipelines())[0]).toMatchObject({ nodes: 1, scenario: 'Fintech' });
  });

  it('STORE-FULL when the browser quota is exceeded', async () => {
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota;
    });
    const err = (await savePipeline(p('a', 'x', '2026-11-15T10:00:00Z')).catch(
      (e: unknown) => e,
    )) as AppError;
    expect(err.code).toBe('STORE-FULL');
    // A real figure or 'no space left', never a placeholder.
    expect(String(err.params.used)).not.toBe('all');
    spy.mockRestore();
  });

  it('STORE-BLOCKED when IndexedDB can not be opened (private mode)', async () => {
    await _resetForTests();
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const err = await listPipelines().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('STORE-BLOCKED');
    spy.mockRestore();
    await _resetForTests();
  });
});

describe('SIM-TAB-CONFLICT · two tabs', () => {
  it('hears saves of the same pipeline from another tab, not its own or other pipelines', async () => {
    const heard: string[] = [];
    const off = onSavedElsewhere('a', (m) => m.type === 'saved' && heard.push(m.updatedAt));
    const other = new BroadcastChannel('streamlab');
    other.postMessage({ type: 'saved', id: 'a', updatedAt: 'T2', tab: 'other-tab' });
    other.postMessage({ type: 'saved', id: 'b', updatedAt: 'T3', tab: 'other-tab' });
    other.postMessage({ type: 'saved', id: 'a', updatedAt: 'T4', tab: TAB });
    await new Promise((r) => setTimeout(r, 50));
    expect(heard).toEqual(['T2']);
    off();
    other.close();
  });
});

describe('SIM-20 · unload rescue', () => {
  it('a rescue copy stays until it is cleared (cleared only once written back)', () => {
    const r = p('r', 'Rescued', '2026-11-15T12:00:00Z');
    expect(writeRescue(r)).toBe(true);
    expect(peekRescue('r')?.name).toBe('Rescued');
    expect(peekRescue('r')?.name).toBe('Rescued');
    clearRescue('r');
    expect(peekRescue('r')).toBeNull();
  });

  it('a corrupt rescue copy is ignored, not thrown', () => {
    localStorage.setItem('streamlab:rescue:bad', '{nope');
    expect(peekRescue('bad')).toBeNull();
  });

  it('deleting a pipeline clears its rescue copy and tells other tabs', async () => {
    await savePipeline(p('d', 'Doomed', '2026-11-15T12:00:00Z'));
    writeRescue(p('d', 'Doomed', '2026-11-15T12:00:01Z'));
    const heard: string[] = [];
    const other = new BroadcastChannel('streamlab');
    other.onmessage = (e: MessageEvent<{ type: string; id: string }>) =>
      heard.push(`${e.data.type}:${e.data.id}`);
    await deletePipeline('d');
    await new Promise((r) => setTimeout(r, 50));
    expect(peekRescue('d')).toBeNull();
    expect(heard).toContain('deleted:d');
    other.close();
  });
});

describe('LEARN-01 · course progress', () => {
  it('is saved per chapter and read back', async () => {
    expect(await getProgress()).toEqual({});
    await setChapterStatus('event-time', 'started');
    await setChapterStatus('event-time', 'done');
    await setChapterStatus('watermarks', 'started');
    await _resetForTests(); // a new visit
    expect(await getProgress()).toEqual({ 'event-time': 'done', watermarks: 'started' });
  });
});

describe('STORE-UPGRADE-BLOCKED · this tab is older than the database', () => {
  it('a VersionError on open says reload, not "not letting Stream Lab save"', async () => {
    const req = indexedDB.open('streamlab', 99); // another tab, on newer code
    await new Promise((r) => (req.onsuccess = r));
    req.result.close();
    await expect(getProgress()).rejects.toMatchObject({ code: 'STORE-UPGRADE-BLOCKED' });
  });
});
