import { invoke } from '@tauri-apps/api/core';
import { AppError } from '@sl/errors';
import { TransportError, type Connection, type FlinkHttp, type TransportFailure } from '@sl/flink';

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

/** True inside the Tauri shell (the browser dev server and tests have no IPC). */
export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The FlinkHttp the app uses in the shell: the Rust command flink_request (FLINK_API.md). It rejects with a typed
 * kind; `keychain` is CONN-KEYCHAIN, every other kind a TransportError the readers map with fromTransport().
 * inline: the form's typed secrets for Test before save (by part: login, gateway, proxy).
 */
export function tauriHttp(c: Connection, inline?: Record<string, string>, call: Invoke = invoke): FlinkHttp {
  return async (req) => {
    try {
      return (await call('flink_request', { conn: c, req, inline: inline ?? null })) as Awaited<
        ReturnType<FlinkHttp>
      >;
    } catch (e) {
      const kind = (e as { kind?: unknown } | null)?.kind;
      if (kind === 'keychain') throw new AppError('CONN-KEYCHAIN', { conn: c.name }, e);
      if (typeof kind === 'string') throw new TransportError(e as TransportFailure);
      throw new AppError('CONN-IO', { host: c.name, reason: 'the request failed' }, e);
    }
  };
}

/** Save a connection's secrets in the OS keychain (CONN-03). A failure is CONN-KEYCHAIN. */
export async function saveSecrets(
  conn: string,
  secrets: { key: string; value: string }[],
  call: Invoke = invoke,
): Promise<void> {
  try {
    for (const s of secrets) await call('secret_set', { key: s.key, value: s.value });
  } catch (e) {
    throw new AppError('CONN-KEYCHAIN', { conn }, e);
  }
}
