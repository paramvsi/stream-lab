import { describe, expect, it } from 'vitest';
import {
  autoMap,
  fileSize,
  MAX_UPLOAD_BYTES,
  missingColumns,
  parseCsv,
  parseJsonl,
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
