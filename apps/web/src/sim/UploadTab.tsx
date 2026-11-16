import {
  autoMap,
  fileSize,
  MAX_UPLOAD_BYTES,
  missingColumns,
  parseCsv,
  parseJson,
  parseJsonl,
  lastCompleteLine,
  typedRows,
  type BadRow,
  type Event,
  type Parsed,
} from '@sl/engine';
import { AppError, ErrorBanner } from '@sl/errors';
import { configOf, labelOf, type Schema } from '@sl/graph';
import { Button, EmptyState, Field, Select, Table, useToast } from '@sl/ui';
import { FileUp, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Events } from './drawer/PreviewPanel';
import { useGraph } from './store';
import { loadRows, saveRows } from './uploads';

const n = (x: number) => x.toLocaleString('en-US');

/**
 * Reads a file as text with progress (W12b "Reading 41,200 events 72%"): bytes drive the percentage, line breaks the
 * count. ponytail: UTF-8 only; a Windows-1252 file shows replacement characters (encoding detection if asked).
 */
async function readText(file: Blob, onProgress: (done: number, lines: number) => void): Promise<string> {
  const reader = file.stream().getReader();
  const dec = new TextDecoder();
  let text = '';
  let done = 0;
  let lines = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    done += r.value.length;
    for (const b of r.value) if (b === 10) lines++;
    text += dec.decode(r.value, { stream: true });
    onProgress(done / Math.max(1, file.size), lines);
  }
  return text + dec.decode();
}

type Step =
  | { kind: 'idle' }
  | { kind: 'large'; file: File }
  | { kind: 'reading'; name: string; progress: number; lines: number }
  | { kind: 'failed'; name: string; reason: string }
  | { kind: 'parsed'; name: string; parsed: Parsed; mapping: Record<string, string | null> };

/**
 * DATA-02 Upload tab (boards W12b reading, W12c bad rows, WX06 too large): pick the Source, drop or choose a CSV
 * or JSON Lines file, map columns to the Source schema (DATA-SCHEMA), see the first 20 rows and the rows that
 * could not be read (DATA-PARSE), then use it. The rows stay in the browser (OPFS).
 */
export function UploadTab({ onDone }: { onDone: () => void }) {
  const nodes = useGraph((s) => s.nodes);
  const uploads = useGraph((s) => s.data.uploads);
  const sources = nodes.filter((x) => x.type === 'Source');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mapFirst = useRef<HTMLSelectElement>(null);
  const toast = useToast();
  const [saveError, setSaveError] = useState<AppError | null>(null);
  const source = sources.find((x) => x.id === sourceId);
  const current = source ? uploads?.[source.id] : undefined;
  // Is the recorded upload still in this browser? (A copied, imported or cleared pipeline may have lost it.)
  const [stored, setStored] = useState<boolean | null>(null);
  const pipelineId = useGraph((s) => s.pipelineId);
  useEffect(() => {
    if (!current || !source) return;
    let live = true;
    void loadRows(pipelineId, source.id).then((r) => live && setStored(r !== null));
    return () => {
      live = false;
    };
  }, [pipelineId, source, current]);

  if (!source)
    return (
      <EmptyState icon={FileUp} title="No Source to upload into" level={3}>
        Add a Source node; an uploaded file replaces its generated events.
      </EmptyState>
    );
  const { schema, eventTime } = configOf(source) as { schema: Schema; eventTime: string };

  const read = async (file: Blob, name: string, cut = false) => {
    setSaveError(null);
    setStep({ kind: 'reading', name, progress: 0, lines: 0 });
    let text: string;
    try {
      text = await readText(file, (p, lines) => setStep({ kind: 'reading', name, progress: p, lines }));
    } catch (e) {
      // Moved, permission, I/O: DATA-READ-FAILED, never a stuck "Reading".
      const reason =
        (e as Error)?.name === 'NotReadableError'
          ? 'it was moved or can no longer be opened'
          : 'the browser could not open it';
      return setStep({ kind: 'failed', name, reason });
    }
    // "Read first 200 MB" cuts mid-row: drop the partial last line rather than keep a cut value.
    if (cut) text = lastCompleteLine(text);
    const parsed = /\.csv$/i.test(name)
      ? parseCsv(text)
      : /\.json$/i.test(name)
        ? parseJson(text)
        : parseJsonl(text);
    setStep({ kind: 'parsed', name, parsed, mapping: autoMap(parsed.columns, schema) });
  };
  const pick = (file: File | undefined) => {
    if (!file) return;
    // DATA-TOO-LARGE (WX06): over 200 MB, offer the first 200 MB.
    if (file.size > MAX_UPLOAD_BYTES) return setStep({ kind: 'large', file });
    void read(file, file.name);
  };

  const chooser = (
    <input
      ref={input}
      type="file"
      accept=".csv,.jsonl,.ndjson,.json,text/csv,application/x-ndjson"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        pick(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {sources.length > 1 && (
        <Field label="Upload into">
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {labelOf(x)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {current && step.kind === 'idle' && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {stored === false
            ? `${current.file} is not in this browser, so ${labelOf(source)} uses the generator. Upload it again to use it.`
            : `${labelOf(source)} reads ${current.file} (${n(current.rows)} events).`}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              useGraph.getState().setUpload(source.id, null);
              toast({ severity: 'success', message: `${labelOf(source)} uses the generator again` });
            }}
          >
            Use the generator instead
          </Button>
        </p>
      )}
      {chooser}
      {step.kind === 'idle' && (
        <div
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center ${drag ? 'border-rose-600 bg-rose-50' : 'border-line-strong'}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
        >
          <Upload size={24} aria-hidden="true" className="text-rose-600" />
          <p className="m-0 text-[15px] font-semibold">Drop to upload</p>
          <p className="m-0 text-[13px] text-muted">CSV or JSON lines · stays in your browser</p>
          <Button size="sm" onClick={() => input.current?.click()}>
            Choose a file
          </Button>
        </div>
      )}
      {step.kind === 'large' && (
        <ErrorBanner
          error={new AppError('DATA-TOO-LARGE', { file: step.file.name, size: fileSize(step.file.size) })}
          onAction={(a) => {
            if (a === 'Read first 200 MB')
              void read(step.file.slice(0, MAX_UPLOAD_BYTES), step.file.name, true);
            else if (a === 'Choose another') {
              setStep({ kind: 'idle' });
              input.current?.click();
            }
          }}
        />
      )}
      {step.kind === 'large' && (
        <p className="m-0 text-[13px] text-muted">
          A browser tab can hold up to 200 MB. Upload a sample (the first 200 MB will be read), or use the
          desktop app with a real cluster.
        </p>
      )}
      {step.kind === 'failed' && (
        <ErrorBanner
          error={new AppError('DATA-READ-FAILED', { file: step.name, reason: step.reason })}
          onAction={(a) => {
            if (a !== 'Choose another') return;
            setStep({ kind: 'idle' });
            input.current?.click();
          }}
        />
      )}
      {saveError && <ErrorBanner error={saveError} />}
      {step.kind === 'reading' && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[14px]">
            Reading {step.name} · {n(step.lines)} rows
          </p>
          <div
            role="progressbar"
            aria-label={`Reading ${step.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(step.progress * 100)}
            className="h-2 overflow-hidden rounded-pill bg-subtle"
          >
            <div className="h-full bg-rose-600" style={{ width: `${Math.round(step.progress * 100)}%` }} />
          </div>
          <p className="m-0 font-mono text-[13px] text-muted">{Math.round(step.progress * 100)}%</p>
        </div>
      )}
      {step.kind === 'parsed' && (
        <Parsed
          step={step}
          schema={schema}
          mapFirst={mapFirst}
          onMap={(field, col) => setStep({ ...step, mapping: { ...step.mapping, [field]: col || null } })}
          onCancel={() => setStep({ kind: 'idle' })}
          eventTime={eventTime}
          onUse={async (rows, file) => {
            const id = useGraph.getState().pipelineId;
            try {
              await saveRows(id, source.id, rows);
            } catch (e) {
              // STORE-FULL (quota) or STORE-BLOCKED (OPFS refused), as the panel's banner.
              if (!(e instanceof AppError)) throw e;
              return setSaveError(e);
            }
            useGraph.getState().setUpload(source.id, { file, rows: rows.length });
            toast({
              severity: 'success',
              message: `${labelOf(source)} reads ${file} (${n(rows.length)} events)`,
            });
            onDone();
          }}
        />
      )}
    </div>
  );
}

function Parsed({
  step,
  schema,
  mapFirst,
  onMap,
  onCancel,
  onUse,
  eventTime,
}: {
  step: Extract<Step, { kind: 'parsed' }>;
  eventTime: string;
  schema: Schema;
  mapFirst: RefObject<HTMLSelectElement | null>;
  onMap: (field: string, col: string) => void;
  onCancel: () => void;
  onUse: (rows: Event[], file: string) => void;
}) {
  const missing = missingColumns(schema, step.mapping);
  const { rows, bad } = missing.length
    ? { rows: [], bad: step.parsed.bad }
    : typedRows(step.parsed, schema, step.mapping, eventTime);
  const total = rows.length + bad.length;
  const report = () => {
    const csv = ['line,problem', ...bad.map((b) => `${b.line},"${b.reason.replace(/"/g, '""')}"`)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${step.name}-bad-rows.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold">Columns for {step.name}</legend>
        {schema.map((f, i) => (
          <Field key={f.name} label={`${f.name}${f.required ? '' : ' (optional)'}`}>
            <Select
              {...(i === 0 ? { ref: mapFirst } : {})}
              value={step.mapping[f.name] ?? ''}
              onChange={(e) => onMap(f.name, e.target.value)}
            >
              <option value="">— not in the file —</option>
              {step.parsed.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </fieldset>
      {missing.length > 0 && (
        <ErrorBanner
          error={new AppError('DATA-SCHEMA', { c: missing[0]! })}
          onAction={(a) => a === 'Map columns' && mapFirst.current?.focus()}
        />
      )}
      {!missing.length && bad.length > 0 && (
        <>
          <ErrorBanner
            error={
              new AppError('DATA-PARSE', {
                n: n(bad.length),
                total: n(total),
                l: n(bad[0]!.line),
                reason: bad[0]!.reason,
              })
            }
            onAction={(a) =>
              a === 'Download report' ? report() : a === 'Skip bad rows' && onUse(rows, step.name)
            }
          />
          <Table<BadRow>
            dense
            label="Rows that could not be read"
            maxHeight={160}
            rows={bad.slice(0, 200)}
            rowKey={(b) => `${b.line}-${b.reason}`}
            columns={[
              { key: 'line', header: 'Line', mono: true, align: 'right', render: (b) => n(b.line) },
              { key: 'problem', header: 'Problem', render: (b) => b.reason },
            ]}
          />
        </>
      )}
      {!missing.length && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">First {Math.min(20, rows.length)} rows</h3>
          <Events rows={rows.slice(0, 20)} label="First rows of the upload" empty="No rows could be read." />
        </section>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => onUse(rows, step.name)}
          {...(missing.length
            ? { disabledReason: 'Map every required column first.' }
            : !rows.length
              ? { disabledReason: 'No rows could be read.' }
              : {})}
        >
          Use {n(rows.length)} {rows.length === 1 ? 'event' : 'events'}
        </Button>
      </div>
    </div>
  );
}
