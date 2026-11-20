import { AppError } from '@sl/errors';
import { describe, expect, it, vi } from 'vitest';
import { tauriSaved } from './saved';

const pay = {
  id: 'p1',
  name: 'payments-prod',
  url: 'https://pay:8081',
  kind: 'standalone',
  env: 'prod',
  readOnly: false,
  basePath: '',
  auth: { type: 'none' },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: 10_000,
  pollMs: 5_000,
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: AppError) => `${e.code}:${String(e.params.what)}`,
  );

describe('saved connections (APP-STORE-FAILED)', () => {
  it('no file yet is an empty list', async () => {
    await expect(tauriSaved(async () => null).load()).resolves.toEqual([]);
  });
  it('a file that is not JSON, or not a list, is a read failure (never read as empty)', async () => {
    expect(await code(tauriSaved(async () => '{"conn').load())).toBe('APP-STORE-FAILED:read');
    expect(await code(tauriSaved(async () => '{"other":[]}').load())).toBe('APP-STORE-FAILED:read');
  });
  it("the store plugin's older file ({connections: [...]}) is read as its list", async () => {
    await expect(tauriSaved(async () => JSON.stringify({ connections: [pay] })).load()).resolves.toEqual([
      pay,
    ]);
  });
  it('an entry that no longer reads as a connection is kept on disk, not deleted', async () => {
    const odd = { id: 'old', name: 'from-an-older-version' };
    const call = vi.fn(async (cmd: string) =>
      cmd === 'connections_read' ? JSON.stringify([pay, odd]) : undefined,
    );
    const s = tauriSaved(call);
    expect((await s.load()).map((c) => c.id)).toEqual(['p1']);
    await s.save([]);
    const [, args] = call.mock.calls.at(-1) as unknown as [string, { text: string }];
    expect(JSON.parse(args.text)).toEqual([odd]);
  });
  it('writes go in order, one at a time; a failed write is a save failure', async () => {
    const done: string[] = [];
    const finish: (() => void)[] = [];
    const call = vi.fn(
      (_cmd: string, a?: Record<string, unknown>) =>
        new Promise<void>((r, j) =>
          finish.push(() => {
            done.push(String(a?.text));
            if (String(a?.text).includes('fail')) j(new Error('disk full'));
            else r();
          }),
        ),
    );
    const s = tauriSaved(call);
    const first = s.save([{ ...pay, name: 'fail' } as never]);
    const second = s.save([]);
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(call).toHaveBeenCalledTimes(1); // the second waits for the first
    finish[0]!();
    expect(await code(first)).toBe('APP-STORE-FAILED:save');
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    finish[1]!();
    expect(await code(second)).toBe('ok');
    expect(done[1]).toBe('[]');
  });
});
