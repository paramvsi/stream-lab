import {
  fileSize,
  lastCompleteLine,
  MAX_UPLOAD_BYTES,
  parseCsv,
  parseJson,
  parseJsonl,
  tableFromFile,
  type Parsed,
} from '@sl/engine';
import { AppError, ErrorBanner, present } from '@sl/errors';
import { Banner, Button, Field, FieldMessage, Input, Select, useToast } from '@sl/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { saveRefTable } from '../storage';
import { useRefTables } from './refTables';
import { readText } from './UploadTab';

type File_ = { name: string; parsed: Parsed };

/** A file name → a table name: lower case, letters, digits and underscores. */
const tableName = (file: string) =>
  file
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'table';

/**
 * DATA-03 "Upload table" (board W13's button): a CSV or JSON-lines file becomes a reference table in this browser
 * (IndexedDB), with a key column and, if it has `valid_from`, versions. Uploading a name again replaces that table.
 * The form keeps what was chosen when saving fails.
 */
export function RefTableUpload({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File_ | null>(null);
  const [large, setLarge] = useState<File | null>(null);
  const [failed, setFailed] = useState<{ name: string; reason: string } | null>(null);
  const [saveError, setSaveError] = useState<AppError | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [versioned, setVersioned] = useState(false);
  const [tried, setTried] = useState(false);
  const vId = useId();
  // The chooser opens at once (the button said "Upload table").
  useEffect(() => input.current?.click(), []);

  const read = async (blob: Blob, fname: string, cut = false) => {
    setFailed(null);
    setLarge(null);
    let text: string;
    try {
      text = await readText(blob, () => {});
    } catch (e) {
      const reason =
        (e as Error)?.name === 'NotReadableError'
          ? 'it was moved or can no longer be opened'
          : 'the browser could not open it';
      return setFailed({ name: fname, reason });
    }
    if (cut && !/\.json$/i.test(fname)) text = lastCompleteLine(text);
    const parsed = /\.csv$/i.test(fname)
      ? parseCsv(text)
      : /\.json$/i.test(fname)
        ? parseJson(text, cut)
        : parseJsonl(text);
    setFile({ name: fname, parsed });
    setName(tableName(fname));
    const cols = parsed.columns;
    setKey(cols.find((c) => c === 'id' || c.endsWith('_id')) ?? cols[0] ?? '');
    setVersioned(cols.includes('valid_from'));
    setTried(false);
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) return setLarge(f);
    void read(f, f.name);
  };

  const result = file ? tableFromFile(file.parsed, { name: name.trim(), key, versioned }) : null;
  const issue = (f: 'name' | 'key' | 'versioned') => {
    const i = result?.issues.find((x) => x.field === f);
    return i && tried ? present(new AppError(i.code as never, i.params ?? {})).message : undefined;
  };
  const nameError =
    tried && !name.trim() ? present(new AppError('NODE-REQUIRED', { field: 'Name' })).message : issue('name');
  const bad = result?.bad ?? [];
  const save = async () => {
    setTried(true);
    if (!result?.table || !name.trim()) return;
    setSaveError(null);
    try {
      await saveRefTable(result.table);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return setSaveError(e); // STORE-FULL / STORE-BLOCKED; the form keeps its content
    }
    const t = result.table;
    useRefTables.setState((s) => ({ user: { ...s.user, [t.name]: t } }));
    toast({
      severity: 'success',
      message: `Table ${t.name} saved (${t.rows.length.toLocaleString('en-US')} rows).`,
    });
    onDone();
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={input}
        type="file"
        accept=".csv,.jsonl,.ndjson,.json,text/csv,application/x-ndjson"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {!file && !large && !failed && (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-[13px] text-muted">
            CSV or JSON lines, one row per key (or per version, with a{' '}
            <span className="font-mono">valid_from</span> column). It stays in this browser; uploading the
            same name again replaces the table.
          </p>
          <Button size="sm" onClick={() => input.current?.click()}>
            Choose a file
          </Button>
        </div>
      )}
      {large && (
        <ErrorBanner
          error={new AppError('DATA-TOO-LARGE', { file: large.name, size: fileSize(large.size) })}
          onAction={(a) => {
            if (a === 'Read first 200 MB') void read(large.slice(0, MAX_UPLOAD_BYTES), large.name, true);
            else if (a === 'Choose another') input.current?.click();
          }}
        />
      )}
      {failed && (
        <ErrorBanner
          error={new AppError('DATA-READ-FAILED', { file: failed.name, reason: failed.reason })}
          onAction={(a) => a === 'Choose another' && input.current?.click()}
        />
      )}
      {file && (
        <>
          <p className="m-0 text-[13px] text-muted">
            <span className="font-mono text-ink">{file.name}</span> ·{' '}
            {(result?.table?.rows.length ?? file.parsed.rows.length).toLocaleString('en-US')} rows
          </p>
          {/* An empty file can not be a table (a Lookup on it would miss every event). */}
          {result?.issues.some((i) => i.field === 'file') && (
            <ErrorBanner
              error={new AppError('LOOKUP-NO-TABLE', { t: name.trim() || tableName(file.name) })}
            />
          )}
          {bad.length > 0 && (
            <Banner severity="warning">
              {
                present(
                  new AppError('DATA-PARSE', {
                    n: String(bad.length),
                    total: String(file.parsed.rows.length + file.parsed.bad.length),
                    l: String(bad[0]!.line),
                    reason: bad[0]!.reason,
                  }),
                ).message
              }{' '}
              They are left out.
            </Banner>
          )}
          <Field label="Table name" error={nameError}>
            <Input mono value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Key column" help="Lookups join on this column.">
            <Select value={key} onChange={(e) => setKey(e.target.value)}>
              {file.parsed.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {/* A checkbox takes its label around it (Field's id goes to Input/Select only). */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <input
                type="checkbox"
                className="sl-focus"
                checked={versioned}
                aria-describedby={`${vId}-d`}
                aria-invalid={issue('versioned') ? true : undefined}
                onChange={(e) => setVersioned(e.target.checked)}
              />
              Versioned
            </label>
            {issue('versioned') ? (
              <FieldMessage id={`${vId}-d`}>{issue('versioned')}</FieldMessage>
            ) : (
              <p id={`${vId}-d`} className="m-0 text-[13px] text-muted">
                Rows carry valid_from; a Lookup joins the version valid at each event&rsquo;s time.
              </p>
            )}
          </div>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              Save table
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
