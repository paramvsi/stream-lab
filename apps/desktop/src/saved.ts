import { load } from '@tauri-apps/plugin-store';
import { AppError } from '@sl/errors';
import { ConnectionSchema, type Connection } from '@sl/flink';

/** The connections kept on this computer (no secrets: those are in the keychain). */
export interface Saved {
  load(): Promise<Connection[]>;
  save(cs: Connection[]): Promise<void>;
}

/**
 * The Tauri store (ARCHITECTURE.md "State"): connections.json in the app's data folder. A failure is
 * APP-STORE-FAILED; an entry that no longer reads as a connection (an older or hand-edited file) is left out.
 * ponytail: entries left out are not reported; add a notice when a schema change makes that likely.
 */
export function tauriSaved(): Saved {
  const file = () => load('connections.json', { defaults: {}, autoSave: false });
  return {
    async load() {
      try {
        const v = await (await file()).get<unknown[]>('connections');
        return (v ?? []).flatMap((x) => {
          const p = ConnectionSchema.safeParse(x);
          return p.success ? [p.data] : [];
        });
      } catch (e) {
        throw new AppError('APP-STORE-FAILED', { what: 'read' }, e);
      }
    },
    async save(cs) {
      try {
        const s = await file();
        await s.set('connections', cs);
        await s.save();
      } catch (e) {
        throw new AppError('APP-STORE-FAILED', { what: 'save' }, e);
      }
    },
  };
}
