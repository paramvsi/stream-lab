import { BUILTIN_TABLES, refSchemas, type BuiltinTable } from '@sl/engine';
import type { SchemaCtx } from '@sl/graph';
import { create } from 'zustand';

/** DATA-03: tables imported in this browser (IndexedDB `refTables`), loaded when a workspace opens. */
export const useRefTables = create<{ user: Record<string, BuiltinTable> }>(() => ({ user: {} }));

/** Every table a Lookup can use: the fintech pack's (DATA-05) and the imported ones. */
// Built-in names win over an imported table of the same name (the shipped scenarios depend on them).
export const allTables = (): Record<string, BuiltinTable> => ({
  ...useRefTables.getState().user,
  ...BUILTIN_TABLES,
});

let ctxFor: Record<string, BuiltinTable> | null = null;
let ctx: SchemaCtx = { refTables: refSchemas(BUILTIN_TABLES) };
/**
 * The reference tables every check and run sees. Passed explicitly to validate, propagate and connectionIssue,
 * so Lookups know their table's fields (no LOOKUP-NO-TABLE, MORNING D33). Same object until the tables change.
 */
export function refCtx(): SchemaCtx {
  const user = useRefTables.getState().user;
  if (user !== ctxFor) {
    ctxFor = user;
    ctx = { refTables: refSchemas({ ...user, ...BUILTIN_TABLES }) };
  }
  return ctx;
}
