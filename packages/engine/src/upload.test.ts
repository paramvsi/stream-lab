import { describe, expect, it } from 'vitest';
import {
  autoMap,
  fileSize,
  MAX_UPLOAD_BYTES,
  missingColumns,
  parseCsv,
  parseJsonl,
  tableFromFile,
  typedRows,
} from './upload';

const SCHEMA = [
  { name: 'card_id', type: 'string', required: true },
  { name: 'amount', type: 'number', required: true },
  { name: 'event_time', type: 'timestamp', required: true },
  { name: 'note', type: 'string', required: false },
] as const;
const schema = SCHEMA.map((f) => ({ ...f }));

describe('DATA-02 · CSV', () => {
  it('reads quotes, escaped quotes, commas and newlines inside quotes, CRLF', () => {
    const p = parseCsv('card_id,amount,note\r\nc_1,10,"hi, ""you""\nthere"\r\nc_2,5,\r\n');
    expect(p.columns).toEqual(['card_id', 'amount', 'note']);
    expect(p.rows).toEqual([
      { card_id: 'c_1', amount: '10', note: 'hi, "you"\nthere' },
      { card_id: 'c_2', amount: '5', note: '' },
    ]);
    expect(p.lines).toEqual([2, 4]);
  });
  it('a row with the wrong number of values and an unclosed quote are bad rows with their line', () => {
    const p = parseCsv('a,b\n1,2\n1,2,3\n"open,4');
    expect(p.bad).toEqual([
      { line: 3, reason: '3 values for 2 columns' },
      { line: 4, reason: 'a quote is never closed' },
    ]);
  });
});

describe('DATA-02 · JSONL', () => {
  it('one object per line; blank lines skipped; bad lines reported', () => {
    const p = parseJsonl('{"card_id":"c_1","amount":10}\n\n[1]\n{oops\n{"card_id":"c_2","note":"x"}');
    expect(p.rows).toHaveLength(2);
    expect(p.columns).toEqual(['card_id', 'amount', 'note']);
    expect(p.bad).toEqual([
      { line: 3, reason: 'not a JSON object' },
      { line: 4, reason: 'not valid JSON' },
    ]);
  });
});

describe('DATA-02 · mapping and types (DATA-SCHEMA, DATA-PARSE)', () => {
  it('maps by name ignoring case; missing required columns are named', () => {
    const m = autoMap(['Card_ID', 'amount', 'ts'], schema);
    expect(m).toEqual({ card_id: 'Card_ID', amount: 'amount', event_time: null, note: null });
    expect(missingColumns(schema, m)).toEqual(['event_time']);
    expect(missingColumns(schema, { ...m, event_time: 'ts' })).toEqual([]);
  });
  it('types values to the schema; rows that do not fit are reported by line', () => {
    const p = parseCsv(
      'card_id,amount,ts\nc_1,10.5,2026-11-15T12:00:00Z\nc_2,abc,2026-11-15T12:00:01Z\nc_3,1,yesterday\n,1,2026-11-15T12:00:02Z\nc_5,2,1794744000000',
    );
    const { rows, bad } = typedRows(p, schema, { ...autoMap(p.columns, schema), event_time: 'ts' });
    expect(rows).toEqual([
      { card_id: 'c_1', amount: 10.5, event_time: '2026-11-15T12:00:00.000Z', note: null },
      { card_id: 'c_5', amount: 2, event_time: new Date(1794744000000).toISOString(), note: null },
    ]);
    expect(bad).toEqual([
      { line: 3, reason: '"amount" is not a number' },
      { line: 4, reason: '"event_time" is not a date and time' },
      { line: 5, reason: '"card_id" is empty' },
    ]);
  });
  it('DATA-TOO-LARGE limit is 200 MB; sizes read like the catalog example', () => {
    expect(MAX_UPLOAD_BYTES).toBe(209715200);
    expect(fileSize(224 * 1024 * 1024)).toBe('224 MB');
    expect(fileSize(2048)).toBe('2 KB');
  });
});

describe('upload audit · parsing', () => {
  it('#2 a stray opening quote costs one row, not the rest of the file', () => {
    const p = parseCsv('a,b\n1,2\n"3,4\n5,6\n7,8');
    expect(p.bad).toEqual([{ line: 3, reason: 'a quote is never closed' }]);
    expect(p.rows).toEqual([
      { a: '1', b: '2' },
      { a: '5', b: '6' },
      { a: '7', b: '8' },
    ]);
  });
  it('#3 an out-of-range time is a bad row, not a crash', () => {
    const p = parseJsonl('{"card_id":"c","amount":1,"event_time":1e20}');
    expect(typedRows(p, schema, autoMap(p.columns, schema)).bad).toEqual([
      { line: 1, reason: '"event_time" is not a date and time' },
    ]);
  });
  it('#5 a file cut at the size limit drops its partial last line', async () => {
    const { lastCompleteLine } = await import('./upload');
    expect(lastCompleteLine('a,b\n1,2\n3,4')).toBe('a,b\n1,2\n');
  });
  it('#9 duplicate headers keep both columns (the second is renamed)', () => {
    const p = parseCsv('a,amount,amount\nx,10,99');
    expect(p.columns).toEqual(['a', 'amount', 'amount_2']);
    expect(p.rows[0]).toEqual({ a: 'x', amount: '10', amount_2: '99' });
  });
  it('#11 blank or non-decimal numbers are bad rows, not 0 or hex', () => {
    const p = parseCsv('card_id,amount,event_time\nc, ,2026-11-15T12:00:00Z\nc,0x1A,2026-11-15T12:00:00Z');
    expect(typedRows(p, schema, autoMap(p.columns, schema)).bad.map((b) => b.reason)).toEqual([
      '"amount" is empty',
      '"amount" is not a number',
    ]);
  });
  it('#10 the event-time field is required even when the schema marks it optional', () => {
    const opt = schema.map((f) => (f.name === 'event_time' ? { ...f, required: false } : f));
    const p = parseCsv('card_id,amount,event_time\nc,1,');
    expect(typedRows(p, opt, autoMap(p.columns, opt), 'event_time').bad).toEqual([
      { line: 2, reason: '"event_time" is empty' },
    ]);
  });
  it('#12 a .json file holding an array of objects is read as rows', async () => {
    const { parseJson } = await import('./upload');
    const p = parseJson('[\n {"a": 1},\n {"a": 2}\n]');
    expect(p.rows).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('WX06 sizes over 1 GB read as GB; just over the limit is not "200 MB"', () => {
    expect(fileSize(1.4 * 1024 ** 3)).toBe('1.4 GB');
    expect(fileSize(MAX_UPLOAD_BYTES + 1)).toBe('201 MB');
  });
});

describe('fintech audit · upload', () => {
  it('#4 renamed duplicate headers never collide with an existing name', () => {
    const p = parseCsv('amount,amount,amount_2\n1,2,3');
    expect(p.columns).toEqual(['amount', 'amount_3', 'amount_2']);
    expect(p.rows[0]).toEqual({ amount: '1', amount_3: '2', amount_2: '3' });
  });
  it('#8 a .json array cut mid-way keeps its complete items, with their file lines', async () => {
    const { parseJson } = await import('./upload');
    const p = parseJson('[\n  {"a": 1},\n  {"a": "x",\n   "b": 2},\n  {"a": 3, "b"');
    expect(p.rows).toEqual([{ a: 1 }, { a: 'x', b: 2 }]);
    expect(p.lines).toEqual([2, 3]);
  });
  it('#11 a CR-only file recovers after a stray quote', () => {
    const p = parseCsv('a,b\r1,2\r"3,4\r5,6');
    expect(p.rows).toEqual([
      { a: '1', b: '2' },
      { a: '5', b: '6' },
    ]);
  });
});

describe('tables audit · JSON scanner', () => {
  it('#1 a stray bracket costs one item, never the rest; trailing text and non-objects are reported', async () => {
    const { parseJson } = await import('./upload');
    const p = parseJson('[{"a":1}}, {"a":2}, {"a":3}]');
    expect(p.rows).toEqual([{ a: 2 }, { a: 3 }]);
    expect(p.bad).toEqual([{ line: 1, reason: 'not valid JSON' }]);
    expect(parseJson('[{"a":1}, 5]').bad).toEqual([{ line: 1, reason: 'not a JSON object' }]);
    expect(parseJson('[{"a":1}, "x", {"a":2}]').bad).toEqual([{ line: 1, reason: 'not a JSON object' }]);
    expect(parseJson('[{"a":1}] [{"a":2}]').bad).toEqual([{ line: 1, reason: 'text after the array' }]);
    expect(parseJson('[\r{"a":1},\r{"a":2}]').lines).toEqual([2, 3]);
  });
});

describe('chaos audit · JSON', () => {
  it('#4 a broken (not cut) array says so; a cut one drops only its open item', async () => {
    const { parseJson } = await import('./upload');
    expect(parseJson('[{"a":1},\n{"a":"x},\n{"a":3},\n{"a":4}]').bad).toEqual([
      { line: 2, reason: 'a string is never closed' },
    ]);
    expect(parseJson('[{"a":1},\n{"a":2}').bad).toEqual([{ line: 2, reason: 'the array is never closed' }]);
    expect(parseJson('[{"a":1},\n{"a":2}', true)).toMatchObject({ rows: [{ a: 1 }], bad: [] });
  });
  it('#5 200,000 items parse in well under a second', async () => {
    const { parseJson } = await import('./upload');
    const text = `[${Array.from({ length: 200000 }, (_, i) => `{"payment_id":"p${i}","amount":${i}.5,"currency":"AED"}`).join(',\n')}]`;
    const t = performance.now();
    expect(parseJson(text).rows).toHaveLength(200000);
    expect(performance.now() - t).toBeLessThan(1500); // ~150 ms here; headroom for slow CI
  });
});

describe('storage audit · JSON', () => {
  it('#5 an array that ends without "]" is reported, and its complete last item is kept', async () => {
    const { parseJson } = await import('./upload');
    expect(parseJson('[{"a":1},').bad).toEqual([{ line: 1, reason: 'the array is never closed' }]);
    expect(parseJson('[\n')).toMatchObject({
      rows: [],
      bad: [{ line: 1, reason: 'the array is never closed' }],
    });
    expect(parseJson('[{"a":1},\n{"a":2}')).toMatchObject({
      rows: [{ a: 1 }, { a: 2 }],
      bad: [{ line: 2, reason: 'the array is never closed' }],
    });
  });
});

describe('inspector audit · upload', () => {
  it('#5 a .json holding JSON Lines, cut at the limit, drops its partial last line quietly', async () => {
    const { parseJson } = await import('./upload');
    expect(parseJson('{"a":1}\n{"a":2}\n{"a":3,"b":"x', true)).toMatchObject({
      rows: [{ a: 1 }, { a: 2 }],
      bad: [],
    });
  });
});

describe('DATA-03 tableFromFile', () => {
  const csv = (t: string) => parseCsv(t);
  it('infers column types, keeps the key column first-class and drops empty names', () => {
    const r = tableFromFile(csv('merchant_id,flag,limit,active\nm1,watch,100,true\nm2,ok,2.5,false\n'), {
      name: 'merchant_flags',
      key: 'merchant_id',
      versioned: false,
    });
    expect(r.issues).toEqual([]);
    expect(r.table!.columns).toEqual([
      { name: 'merchant_id', type: 'string', required: true },
      { name: 'flag', type: 'string', required: true },
      { name: 'limit', type: 'number', required: true },
      { name: 'active', type: 'boolean', required: true },
    ]);
    expect(r.table!.rows[1]).toEqual({ merchant_id: 'm2', flag: 'ok', limit: 2.5, active: false });
  });
  it('a column with a blank cell is optional; a row with a blank key is a bad row (DATA-PARSE)', () => {
    const r = tableFromFile(csv('id,v\na,1\n,2\nc,3\n'), { name: 't', key: 'id', versioned: false });
    expect(r.issues).toEqual([]);
    expect(r.table!.rows.map((x) => x['id'])).toEqual(['a', 'c']);
    expect(r.bad).toEqual([{ line: 3, reason: 'no id' }]);
    expect(
      tableFromFile(csv('id,v\na,1\nc,\n'), { name: 't', key: 'id', versioned: false }).table!.columns[1],
    ).toEqual({ name: 'v', type: 'number', required: false });
  });
  it('REF-NAME-TAKEN for a built-in name; REF-NO-VALID-FROM when versioned without valid_from', () => {
    const p = csv('id,v\na,1\n');
    expect(tableFromFile(p, { name: 'merchants', key: 'id', versioned: false }).issues).toEqual([
      { field: 'name', code: 'REF-NAME-TAKEN', params: { t: 'merchants' } },
    ]);
    expect(tableFromFile(p, { name: 't', key: 'id', versioned: true }).issues).toEqual([
      { field: 'versioned', code: 'REF-NO-VALID-FROM' },
    ]);
  });
  it('versioned: valid_from becomes a timestamp column and rows keep ISO strings', () => {
    const r = tableFromFile(csv('currency,rate,valid_from\nAED,0.27,2026-01-01T12:00:00Z\n'), {
      name: 'fx',
      key: 'currency',
      versioned: true,
    });
    expect(r.issues).toEqual([]);
    expect(r.table!.versioned).toBe(true);
    expect(r.table!.columns.find((c) => c.name === 'valid_from')!.type).toBe('timestamp');
  });
});
