import { AppError } from '@sl/errors';
import { TransportError, type Connection } from '@sl/flink';
import { describe, expect, it, vi } from 'vitest';
import { saveSecrets, tauriHttp } from './tauri';

const c = { id: 'a', name: 'payments-prod' } as Connection;

describe('tauriHttp', () => {
  it('sends the connection, the request and the inline secrets to flink_request', async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: '{}', url: 'https://h' });
    const http = tauriHttp(c, { login: 's3cret' }, call);
    await expect(http({ method: 'GET', path: '/config' })).resolves.toMatchObject({ status: 200 });
    expect(call).toHaveBeenCalledWith('flink_request', {
      conn: c,
      req: { method: 'GET', path: '/config' },
      inline: { login: 's3cret' },
    });
  });
  it('a typed failure kind becomes a TransportError for fromTransport()', async () => {
    const call = vi.fn().mockRejectedValue({ kind: 'refused', host: 'h', port: 8081 });
    const e = await tauriHttp(c, undefined, call)({ method: 'GET', path: '/' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError);
    expect((e as TransportError).failure).toEqual({ kind: 'refused', host: 'h', port: 8081 });
  });
  it('CONN-KEYCHAIN: a keychain failure names the connection', async () => {
    const call = vi.fn().mockRejectedValue({ kind: 'keychain', host: 'h' });
    const e = await tauriHttp(c, undefined, call)({ method: 'GET', path: '/' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('CONN-KEYCHAIN');
    expect((e as AppError).params).toEqual({ conn: 'payments-prod' });
  });
  it('anything else is CONN-IO, never the raw text', async () => {
    const call = vi.fn().mockRejectedValue('panic: something internal');
    const e = await tauriHttp(c, undefined, call)({ method: 'GET', path: '/' }).catch((x: unknown) => x);
    expect((e as AppError).code).toBe('CONN-IO');
  });
});

describe('saveSecrets', () => {
  it('writes each secret, and CONN-KEYCHAIN when the keychain refuses', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    await saveSecrets('p', [{ key: 'streamlab/a/login', value: 'x' }], ok);
    expect(ok).toHaveBeenCalledWith('secret_set', { key: 'streamlab/a/login', value: 'x' });
    const no = vi.fn().mockRejectedValue('denied');
    const e = await saveSecrets('p', [{ key: 'k', value: 'v' }], no).catch((x: unknown) => x);
    expect((e as AppError).code).toBe('CONN-KEYCHAIN');
  });
});
