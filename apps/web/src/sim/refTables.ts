import { BUILTIN_TABLES, refSchemas } from '@sl/engine';
import type { SchemaCtx } from '@sl/graph';

/**
 * DATA-03/05: the reference tables every check and run sees (the fintech pack's, for now). Passed explicitly to
 * validate, propagate and connectionIssue, so Lookups know their table's fields (no LOOKUP-NO-TABLE, MORNING D33).
 */
export const REF_CTX: SchemaCtx = { refTables: refSchemas(BUILTIN_TABLES) };
