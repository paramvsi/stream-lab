import { invoke } from '@tauri-apps/api/core';
import { AppError } from '@sl/errors';
import { ConnectionSchema, type Connection } from '@sl/flink';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The connections kept on this computer (no secrets: those are in the keychain). */
export interface Saved {
  load(): Promise<Connection[]>;
  save(cs: Connection[]): Promise<void>;
}

/**
 * connections.json through the shell's own commands (read from disk each time; written atomically). A file that is
 * not JSON, or not a list, is APP-STORE-FAILED (read), and nothing is written over it. An entry that no longer reads
 * as a connection (an older or hand-edited file) is not shown, but is kept: written back as it was, never deleted.
 * Writes go one at a time, in order (a later list never lands before an earlier one).
 * ponytail: kept entries are not reported; add a notice when a schema change makes them likely.
 */
export function tauriSaved(call: Invoke = invoke): Saved {
  let kept: unknown[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async load() {
      let list: unknown;
      try {
        const text = (await call('connections_read')) as string | null;
        list = text === null ? [] : JSON.parse(text);
      } catch (e) {
        throw new AppError('APP-STORE-FAILED', { what: 'read' }, e);
      }
      // The store plugin's file (afee9d5..7375b3f) is {"connections": [...]}: read it as the list it holds.
      if (list && typeof list === 'object' && Array.isArray((list as { connections?: unknown }).connections))
        list = (list as { connections: unknown[] }).connections;
      if (!Array.isArray(list)) throw new AppError('APP-STORE-FAILED', { what: 'read' });
      const cs: Connection[] = [];
      kept = [];
      for (const x of list) {
        const p = ConnectionSchema.safeParse(x);
        if (p.success) cs.push(p.data);
        else kept.push(x);
      }
      return cs;
    },
    save(cs) {
      const text = JSON.stringify([...cs, ...kept], null, 2);
      const run = queue.then(() => call('connections_write', { text }));
      queue = run.catch(() => undefined); // the next write waits for this one, whatever its outcome
      return run.then(
        () => undefined,
        (e: unknown) => {
          throw new AppError('APP-STORE-FAILED', { what: 'save' }, e);
        },
      );
    },
  };
}
