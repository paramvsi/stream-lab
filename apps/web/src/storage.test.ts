import 'fake-indexeddb/auto';
import { AppError } from '@sl/errors';
import { newPipeline } from '@sl/graph';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTests,
  deletePipeline,
  getPipeline,
  listPipelines,
  onSavedElsewhere,
  savePipeline,
  TAB,
  takeRescue,
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
    const off = onSavedElsewhere('a', (m) => heard.push(m.updatedAt));
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
  it('a rescue copy is read back once, then gone', () => {
    const r = p('r', 'Rescued', '2026-11-15T12:00:00Z');
    expect(writeRescue(r)).toBe(true);
    expect(takeRescue('r')?.name).toBe('Rescued');
    expect(takeRescue('r')).toBeNull();
  });

  it('a corrupt rescue copy is ignored, not thrown', () => {
    localStorage.setItem('streamlab:rescue:bad', '{nope');
    expect(takeRescue('bad')).toBeNull();
  });
});
