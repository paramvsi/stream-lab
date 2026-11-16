import type { Schema } from '@sl/graph';
import { parseTime } from './engine';
import type { Event } from './random';

/**
 * DATA-02 upload, the pure part: size check, CSV/JSONL parsing, column mapping to the Source schema, typed rows
 * and the bad-row report. Byte reading, progress and OPFS storage live in the web app.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // DATA-TOO-LARGE

export interface BadRow {
  /** 1-based line in the file. */
  line: number;
  reason: string;
}
export interface Parsed {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  /** File line of each row (1-based), for the bad-row report. */
  lines: number[];
  bad: BadRow[];
}

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes, CRLF. First row is the header. */
export function parseCsv(text: string): Parsed {
  const records: { cells: string[]; line: number }[] = [];
  const bad: BadRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let wasQuoted = false;
  const endCell = () => {
    cells.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    if (!(cells.length === 1 && cells[0] === '')) records.push({ cells, line: start });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '' && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else cell += ch;
  }
  if (quoted) bad.push({ line: start, reason: 'a quote is never closed' });
  else if (cell !== '' || cells.length) endRecord();
  const [header, ...body] = records;
  const columns = (header?.cells ?? []).map((c) => c.trim());
  const rows: Parsed['rows'] = [];
  const lines: number[] = [];
  for (const r of body) {
    if (r.cells.length !== columns.length) {
      bad.push({ line: r.line, reason: `${r.cells.length} values for ${columns.length} columns` });
      continue;
    }
    rows.push(Object.fromEntries(columns.map((c, i) => [c, r.cells[i]!])));
    lines.push(r.line);
  }
  bad.sort((a, b) => a.line - b.line);
  return { columns, rows, lines, bad };
}

/** JSON Lines: one object per line; blank lines are skipped. */
export function parseJsonl(text: string): Parsed {
  const rows: Parsed['rows'] = [];
  const lines: number[] = [];
  const bad: BadRow[] = [];
  const columns = new Set<string>();
  text.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    try {
      const v: unknown = JSON.parse(l);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      const row = v as Record<string, string | number | boolean | null>;
      Object.keys(row).forEach((k) => columns.add(k));
      rows.push(row);
      lines.push(i + 1);
    } catch (e) {
      bad.push({
        line: i + 1,
        reason: (e as Error).message === 'not an object' ? 'not a JSON object' : 'not valid JSON',
      });
    }
  });
  return { columns: [...columns], rows, lines, bad };
}

/** Default mapping: each schema field to the column with the same name (case-insensitive), else unmapped. */
export function autoMap(columns: string[], schema: Schema): Record<string, string | null> {
  return Object.fromEntries(
    schema.map((f) => [f.name, columns.find((c) => c.toLowerCase() === f.name.toLowerCase()) ?? null]),
  );
}

/** DATA-SCHEMA: required schema fields with no column mapped. */
export const missingColumns = (schema: Schema, mapping: Record<string, string | null>) =>
  schema.filter((f) => f.required && !mapping[f.name]).map((f) => f.name);

/** Rows typed to the Source schema; values that do not fit go to the bad-row report (DATA-PARSE). */
export function typedRows(
  p: Parsed,
  schema: Schema,
  mapping: Record<string, string | null>,
): { rows: Event[]; bad: BadRow[] } {
  const rows: Event[] = [];
  const bad = [...p.bad];
  p.rows.forEach((raw, i) => {
    const out: Event = {};
    for (const f of schema) {
      const col = mapping[f.name];
      const v = col ? raw[col] : undefined;
      const empty = v === undefined || v === null || v === '';
      if (empty) {
        if (f.required) return void bad.push({ line: p.lines[i]!, reason: `"${f.name}" is empty` });
        out[f.name] = null;
        continue;
      }
      if (f.type === 'number') {
        const x = typeof v === 'number' ? v : Number(String(v).trim());
        if (!Number.isFinite(x))
          return void bad.push({ line: p.lines[i]!, reason: `"${f.name}" is not a number` });
        out[f.name] = x;
      } else if (f.type === 'boolean') {
        const s = String(v).trim().toLowerCase();
        if (!['true', 'false', '1', '0'].includes(s))
          return void bad.push({ line: p.lines[i]!, reason: `"${f.name}" is not true or false` });
        out[f.name] = s === 'true' || s === '1';
      } else if (f.type === 'timestamp') {
        const t = parseTime(v);
        if (Number.isNaN(t))
          return void bad.push({ line: p.lines[i]!, reason: `"${f.name}" is not a date and time` });
        out[f.name] = new Date(t).toISOString();
      } else out[f.name] = String(v);
    }
    rows.push(out);
  });
  bad.sort((a, b) => a.line - b.line);
  return { rows, bad };
}

/** "214 MB" style size for DATA-TOO-LARGE. */
export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
