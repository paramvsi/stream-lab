import type { FieldType, Schema } from '@sl/graph';
import { BUILTIN_TABLES, type BuiltinTable } from './fintech';
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
  // Scan from `pos`; a quote never closed costs only its own line: scanning restarts on the next line.
  let pos = 0;
  let line = 1;
  while (pos < text.length) {
    let cells: string[] = [];
    let cell = '';
    let quoted = false;
    let wasQuoted = false;
    let start = line;
    let recordPos = pos;
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
    for (let i = pos; i < text.length; i++) {
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
        recordPos = i + 1;
      } else cell += ch;
    }
    if (!quoted) {
      if (cell !== '' || cells.length) endRecord();
      break;
    }
    bad.push({ line: start, reason: 'a quote is never closed' });
    // Next line break of any kind (LF, CRLF or a lone CR).
    const m = /\r\n|\r|\n/g;
    m.lastIndex = recordPos;
    const next = m.exec(text);
    if (!next) break;
    pos = next.index + next[0].length;
    line = start + 1;
  }
  const [header, ...body] = records;
  // Duplicate headers keep every column: the second "amount" becomes "amount_2" (nothing is overwritten).
  const raw = (header?.cells ?? []).map((c) => c.trim());
  const taken = new Set<string>();
  const columns = raw.map((name, i) => {
    // The first of a name keeps it unless a later header owns it outright; repeats get the next free _N.
    if (!taken.has(name) && raw.indexOf(name) === i) {
      taken.add(name);
      return name;
    }
    let k = 2;
    while (taken.has(`${name}_${k}`) || raw.includes(`${name}_${k}`)) k++;
    taken.add(`${name}_${k}`);
    return `${name}_${k}`;
  });
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

/** The text up to its last line break: a file cut at the size limit loses its partial last row, not a value. */
export const lastCompleteLine = (text: string) => text.slice(0, text.lastIndexOf('\n') + 1);

/**
 * A .json file: an array of objects (else JSON Lines). Items are scanned one by one, so each keeps its file line,
 * and an array cut at the size limit keeps its complete items.
 */
export function parseJson(text: string, cut = false): Parsed {
  const start = text.search(/\S/);
  if (start < 0 || text[start] !== '[') return parseJsonl(cut ? lastCompleteLine(text) : text); // JSON Lines in a .json
  const rows: Parsed['rows'] = [];
  const lines: number[] = [];
  const bad: BadRow[] = [];
  const columns = new Set<string>();
  let line = 1;
  const nl = (k: number) => text[k] === '\n' || (text[k] === '\r' && text[k + 1] !== '\n');
  for (let k = 0; k < start; k++) if (nl(k)) line++;
  const arrayLine = line;
  // Items are split at commas outside strings and brackets; a stray bracket only breaks its own item.
  // Items are sliced by index (not built a character at a time): large files stay fast.
  let depth = 0;
  let inStr = false;
  let from = -1; // first non-space character of the current item
  let itemLine = 0;
  let closed = -1;
  const take = (to: number) => {
    if (from < 0) return;
    const t = text.slice(from, to).trim();
    from = -1;
    try {
      const v: unknown = JSON.parse(t);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      const row = v as Record<string, string | number | boolean | null>;
      for (const c of Object.keys(row)) columns.add(c);
      rows.push(row);
      lines.push(itemLine);
    } catch (e) {
      bad.push({
        line: itemLine,
        reason: (e as Error).message === 'not an object' ? 'not a JSON object' : 'not valid JSON',
      });
    }
  };
  for (let k = start + 1; k < text.length; k++) {
    const ch = text[k]!;
    if (inStr) {
      if (ch === '\\') k++;
      else if (ch === '"') inStr = false;
      else if (nl(k)) line++;
      continue;
    }
    if (nl(k)) {
      line++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch === ',' && depth === 0) {
      take(k);
      continue;
    }
    if (ch === ']' && depth === 0) {
      take(k);
      closed = k;
      break;
    }
    if (from < 0) {
      from = k;
      itemLine = line;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && depth > 0) depth--;
  }
  if (closed >= 0) {
    // Anything but whitespace after the array is reported, not silently ignored.
    const after = text.slice(closed + 1).search(/\S/);
    if (after >= 0) {
      let l = line;
      for (let k = closed + 1; k < closed + 1 + after; k++) if (nl(k)) l++;
      bad.push({ line: l, reason: 'text after the array' });
    }
  } else if (!cut) {
    // Not a cut file: the array (or a string in it) is broken — say so instead of dropping what follows. A
    // complete last item is still read.
    const lastLine = from >= 0 ? itemLine : arrayLine; // the open item, else where the array starts
    if (from >= 0 && !inStr) take(text.length);
    bad.push({ line: lastLine, reason: inStr ? 'a string is never closed' : 'the array is never closed' });
  }
  // A file cut at the size limit drops its open last item, like a partial CSV line.
  return { columns: [...columns], rows, lines, bad: bad.sort((a, b) => a.line - b.line) };
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
  /** The Source's event-time field: always required (an event with no time can't be placed). */
  eventTime?: string,
): { rows: Event[]; bad: BadRow[] } {
  const rows: Event[] = [];
  const bad = [...p.bad];
  p.rows.forEach((raw, i) => {
    const out: Event = {};
    for (const f of schema) {
      const col = mapping[f.name];
      const v = col ? raw[col] : undefined;
      const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
      if (empty) {
        if (f.required || f.name === eventTime)
          return void bad.push({ line: p.lines[i]!, reason: `"${f.name}" is empty` });
        out[f.name] = null;
        continue;
      }
      if (f.type === 'number') {
        // Decimal only: "0x1A" or "1e" are not amounts.
        const txt = String(v).trim();
        const x =
          typeof v === 'number' ? v : /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(txt) ? Number(txt) : NaN;
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
        // Date's range is ±8.64e15 ms: beyond it there is no date (and toISOString would throw).
        if (!Number.isFinite(t) || Math.abs(t) > 8.64e15)
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
  bytes >= 1024 ** 3
    ? `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`
    : bytes >= 1024 * 1024
      ? `${Math.ceil(bytes / (1024 * 1024))} MB` // up, so 200 MB + 1 byte never reads as "200 MB"
      : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

/**
 * DATA-03 "Upload table": parsed CSV/JSONL rows → a reference table, column types inferred (number, boolean,
 * timestamp for valid_from, else string; a blank cell makes a column optional). Rows with a blank key are bad rows
 * (DATA-PARSE). Issues are catalog codes for the form's fields.
 */
export function tableFromFile(
  p: Parsed,
  o: { name: string; key: string; versioned: boolean; description?: string },
): {
  table: BuiltinTable | null;
  bad: BadRow[];
  issues: { field: 'name' | 'key' | 'versioned' | 'file'; code: string; params?: Record<string, string> }[];
} {
  const issues: {
    field: 'name' | 'key' | 'versioned' | 'file';
    code: string;
    params?: Record<string, string>;
  }[] = [];
  if (BUILTIN_TABLES[o.name]) issues.push({ field: 'name', code: 'REF-NAME-TAKEN', params: { t: o.name } });
  if (o.versioned && !p.columns.includes('valid_from'))
    issues.push({ field: 'versioned', code: 'REF-NO-VALID-FROM' });
  const blank = (v: unknown) => v === null || v === undefined || v === '';
  const bad = [...p.bad];
  const rows: Event[] = [];
  const versionedOk = o.versioned && p.columns.includes('valid_from');
  p.rows.forEach((r, i) => {
    const line = p.lines[i] ?? i + 2;
    if (blank(r[o.key])) return bad.push({ line, reason: `no ${o.key}` });
    // As-of lookups sort and search on valid_from: a time that can't be read would put rows in the wrong order.
    const at = versionedOk ? parseTime(r['valid_from']) : 0;
    if (Number.isNaN(at)) return bad.push({ line, reason: 'valid_from is not a time' });
    // A copy: the form calls this on every render, so the parsed file must stay as read.
    rows.push({ ...r, ...(versionedOk ? { valid_from: new Date(at).toISOString() } : {}) } as Event);
  });
  // An empty table would pass LOOKUP-NO-TABLE (checks see columns) and miss every event.
  if (!rows.length) issues.push({ field: 'file', code: 'LOOKUP-NO-TABLE', params: { t: o.name } });
  // A number only when it reads back the same: plain decimals, no leading zeros (codes like 0742), no hex or
  // Infinity, nothing past 15 digits (long ids would collapse into one value).
  const num = (v: unknown) =>
    typeof v === 'number'
      ? Number.isFinite(v) && Math.abs(v) < 1e15
      : typeof v === 'string' && /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v.trim());
  const bool = (v: unknown) => typeof v === 'boolean' || v === 'true' || v === 'false';
  const columns = p.columns
    .filter((c) => c !== '')
    .map((name) => {
      const vals = rows.map((r) => r[name]).filter((v) => !blank(v));
      const type: FieldType =
        name === 'valid_from' && versionedOk
          ? 'timestamp'
          : name === o.key // text, like the event fields it joins with (a number key would block the run)
            ? 'string'
            : vals.length && vals.every(bool)
              ? 'boolean'
              : vals.length && vals.every(num)
                ? 'number'
                : 'string';
      return { name, type, required: vals.length === rows.length };
    });
  for (const r of rows)
    for (const c of columns) {
      const v = r[c.name];
      if (blank(v)) continue;
      if (c.type === 'number') r[c.name] = Number(v);
      else if (c.type === 'boolean') r[c.name] = v === true || v === 'true';
      // Nested JSON stays readable JSON, not "[object Object]".
      else r[c.name] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  const table: BuiltinTable = {
    name: o.name,
    key: o.key,
    description: o.description ?? 'Imported table',
    columns,
    rows,
    ...(o.versioned ? { versioned: true } : {}),
  };
  return { table: issues.length ? null : table, bad, issues };
}
