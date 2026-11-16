import { BASE_TIME, BUILTIN_TABLES, type BuiltinTable, type Event } from '@sl/engine';
import { AppError, ErrorBanner } from '@sl/errors';
import { Button, Dialog, Drawer, Field, Input, Select, Table, useToast } from '@sl/ui';
import { ArrowLeft, Table2, Trash2, Upload } from 'lucide-react';
import { deleteRefTable } from '../storage';
import { useRefTables } from './refTables';
import { RefTableUpload } from './RefTableUpload';
import { useEffect, useRef, useState } from 'react';
import { Events } from './drawer/PreviewPanel';

const n = (x: number) => x.toLocaleString('en-US');
const hms = (iso: string) => iso.slice(11, 19);

/** Distinct valid_from times, oldest first (a versioned table's versions). */
const versionsOf = (t: BuiltinTable) => [...new Set(t.rows.map((r) => String(r['valid_from'])))].sort();

/** "3 versions", "per minute" (evenly spaced versions), or "no" (board W13 "Versioned" column). */
function versioning(t: BuiltinTable) {
  if (!t.versioned) return 'no';
  const v = versionsOf(t);
  const steps = new Set(v.slice(1).map((x, i) => Date.parse(x) - Date.parse(v[i]!)));
  return v.length > 10 && steps.size === 1 && steps.has(60_000) ? 'per minute' : `${n(v.length)} versions`;
}

/** The rows valid at `at`: per key, the latest version whose valid_from is not after it (an as-of lookup). */
function rowsAt(t: BuiltinTable, at: string): Event[] {
  const best = new Map<string, Event>();
  for (const r of t.rows) {
    const from = String(r['valid_from']);
    if (from > at) continue;
    const k = String(r[t.key]);
    const cur = best.get(k);
    // Ties keep the later row, as the engine's binary search does.
    if (!cur || String(cur['valid_from']) <= from) best.set(k, r);
  }
  return [...best.values()];
}

/** An imported table can be deleted (built-in ones can not); a confirmation first, as for any deletion. */
function DeleteTable({ t, onDeleted }: { t: BuiltinTable; onDeleted: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const del = async () => {
    try {
      await deleteRefTable(t.name);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return setError(e);
    }
    useRefTables.setState((s) => {
      const user = { ...s.user };
      delete user[t.name];
      return { user };
    });
    setOpen(false);
    toast({ severity: 'success', message: `Table ${t.name} deleted.` });
    onDeleted();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
      title={`Delete table ${t.name}?`}
      severity="error"
      trigger={
        <Button size="sm" variant="ghost" className="w-fit" icon={<Trash2 size={16} aria-hidden="true" />}>
          Delete table
        </Button>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void del()}>
            Delete
          </Button>
        </>
      }
    >
      <p className="m-0">
        Lookups that use <span className="font-mono">{t.name}</span> will show a missing-table error until you
        upload it again. This cannot be undone.
      </p>
      {error && <ErrorBanner error={error} />}
    </Dialog>
  );
}

function Detail({ t, onBack }: { t: BuiltinTable; onBack: () => void }) {
  const versions = versionsOf(t);
  // Default: the version valid when a run starts (what a default run joins), not the last one.
  const start = new Date(BASE_TIME).toISOString();
  const [at, setAt] = useState(versions.filter((v) => v <= start).at(-1) ?? versions[0] ?? '');
  const i = versions.indexOf(at);
  const next = versions[i + 1];
  const rows = t.versioned ? rowsAt(t, at) : t.rows;
  // Times with the date when it is not the run's day (merchants' first version is the day before).
  const when = (iso: string) =>
    iso.slice(0, 10) === start.slice(0, 10) ? hms(iso) : `${iso.slice(0, 10)} ${hms(iso)}`;
  const until = next ? when(new Date(Date.parse(next) - 1000).toISOString()) : null;
  // The table opened: focus its first control (the drawer's title names the table).
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  const near = versions.slice(Math.max(0, i - 2), i + 3);
  return (
    <div className="flex flex-col gap-4">
      <Button
        ref={back}
        size="sm"
        variant="ghost"
        className="w-fit"
        icon={<ArrowLeft size={16} aria-hidden="true" />}
        onClick={onBack}
      >
        All tables
      </Button>
      {!BUILTIN_TABLES[t.name] && <DeleteTable t={t} onDeleted={onBack} />}
      <p className="m-0 text-[13px] text-muted">
        {t.description}. Key: <span className="font-mono">{t.key}</span>.
      </p>
      {t.versioned && (
        <>
          {/* Board W13b: a short timeline of versions around the selected one. */}
          <div role="group" aria-label="Nearby versions" className="flex flex-wrap gap-1.5">
            {near.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={v === at ? 'primary' : 'ghost'}
                aria-pressed={v === at}
                onClick={() => setAt(v)}
              >
                {when(v)}
              </Button>
            ))}
          </div>
          <Field label="Version valid from">
            <Select value={at} onChange={(e) => setAt(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v.slice(0, 10)} {hms(v)}
                </option>
              ))}
            </Select>
          </Field>
          <p className="m-0 text-[13px] text-muted">
            <span className="font-medium text-ink">
              valid {when(at)}–{until ?? 'on'}
            </span>
            .{' '}
            {next
              ? `An event from ${when(at)} up to ${until} joins these rows. One at ${when(next)} or later sees the next version.`
              : `An event from ${when(at)} on joins these rows (the latest version).`}
          </p>
        </>
      )}
      <Events rows={rows} label={`${t.name} rows`} empty="No rows." />
    </div>
  );
}

/**
 * DATA-03 reference tables (boards W13 list, W13b versioned table): the tables Lookup nodes join with. For now the
 * fintech pack's built-in tables (DATA-05, read-only) and tables uploaded in this browser (replace by uploading the
 * same name again, or delete).
 * ponytail: no in-app cell editor (no board shows one; MORNING D47).
 */
export function RefTablesButton() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const user = useRefTables((s) => s.user);
  const all = { ...user, ...BUILTIN_TABLES }; // as the checks and runs see them
  // Name, key or description (W13 "Search tables").
  const needle = q.trim().toLowerCase();
  const tables = Object.values(all).filter((t) =>
    [t.name, t.key, t.description.toLowerCase()].some((x) => x.includes(needle)),
  );
  const picked = pick ? all[pick] : undefined;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Table2 size={16} aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Tables
      </Button>
      <Drawer
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPick(null);
            setUploading(false);
          }
        }}
        // Board W13b: an open table names the drawer.
        title={uploading ? 'Upload table' : picked ? picked.name : 'Reference tables'}
        size={560}
      >
        {uploading ? (
          <RefTableUpload onDone={() => setUploading(false)} />
        ) : picked ? (
          <Detail t={picked} onBack={() => setPick(null)} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-2">
              <Field label="Search tables" className="min-w-0 flex-1">
                <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
              </Field>
              {/* Board W13: "Upload table" next to the search. */}
              <Button icon={<Upload size={16} aria-hidden="true" />} onClick={() => setUploading(true)}>
                Upload table
              </Button>
            </div>
            <Table<BuiltinTable>
              label="Reference tables"
              rows={tables}
              rowKey={(t) => t.name}
              onSelect={(t) => setPick(t.name)}
              columns={[
                { key: 'name', header: 'Table', mono: true, render: (t) => t.name },
                { key: 'rows', header: 'Rows', align: 'right', mono: true, render: (t) => n(t.rows.length) },
                { key: 'key', header: 'Key', mono: true, render: (t) => t.key },
                { key: 'versioned', header: 'Versioned', render: (t) => versioning(t) },
              ]}
            />
            {!tables.length && <p className="m-0 text-[13px] text-muted">No table matches “{q}”.</p>}
          </div>
        )}
      </Drawer>
    </>
  );
}
