import type { ErrorCode } from '@sl/errors/catalog';
import type { z } from 'zod';

export type FieldType = 'string' | 'number' | 'boolean' | 'timestamp';
export interface Field {
  name: string;
  type: FieldType;
  required: boolean;
}
/** Ordered list of fields flowing on one edge (SIM-25 shows it as JSON Schema; see toJsonSchema). */
export type Schema = Field[];

export type Category = 'Sources' | 'Transform' | 'Enrich' | 'Time & state' | 'Quality' | 'Outputs';
export const CATEGORIES: readonly Category[] = [
  'Sources',
  'Transform',
  'Enrich',
  'Time & state',
  'Quality',
  'Outputs',
];

export type NodeType =
  | 'Source'
  | 'Generator'
  | 'Filter'
  | 'Map'
  | 'Lookup'
  | 'Join'
  | 'Window'
  | 'Top-N'
  | 'Pattern'
  | 'Validate'
  | 'Deduplicate'
  | 'Dead-letter'
  | 'Union'
  | 'Route'
  | 'Sink'
  | 'SQL';

export interface PortSpec {
  id: string;
  label: string;
  /** main = circle handle; side outputs (rejected, late) = diamond (SIMULATOR.md). */
  kind: 'main' | 'side';
  /** Inputs only: accepts any number of edges (Union). Otherwise one edge per input port. */
  multi?: boolean;
}

export interface SchemaCtx {
  /** Reference tables by name (M3 fills these), for Lookup. */
  refTables: Record<string, Schema>;
}

export interface NodeSpec<C = unknown> {
  type: NodeType;
  category: Category;
  description: string;
  /** Shown as "(v1)" and kept out of the Phase 1 palette (TRACEABILITY.md). */
  v1?: boolean;
  config: z.ZodType<C>;
  defaults: () => C;
  inputs: (config: C) => PortSpec[];
  outputs: (config: C) => PortSpec[];
  /** Mono subtitle on the node card (board B03). */
  summary: (config: C) => string;
  /** Output schema per output port. `inputs[port]` lists one schema per incoming edge (Union has several). */
  outputSchema: (inputs: Record<string, Schema[]>, config: C, ctx: SchemaCtx) => Record<string, Schema>;
  /**
   * Fields this node reads from its input(s); missing ones are SIM-PORT-TYPE / SIM-SCHEMA-DRIFT.
   * `type`, when set, is also checked on connect (e.g. a sum needs a number).
   */
  requires: (config: C) => { port: string; field: string; type?: FieldType | FieldType[] }[];
}

export interface PipelineNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  config: unknown;
  disabled?: boolean;
  /** Editable name; falls back to the type. */
  label?: string;
}

export interface PipelineEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/** Problems the graph package reports; the UI turns them into AppErrors via the catalog. */
export interface Issue {
  code: ErrorCode;
  params: Record<string, string | number>;
  nodeId?: string;
  edgeId?: string;
  /** Config path the problem belongs to ("expr", "rules.1.expr"), for field-level errors in the drawer. */
  field?: string;
  /** Character range inside an expression field, and a quick-fix replacement (CEL). */
  from?: number;
  to?: number;
  fix?: string;
}
