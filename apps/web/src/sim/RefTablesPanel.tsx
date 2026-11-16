import { BUILTIN_TABLES, type BuiltinTable, type Event } from '@sl/engine';
import { Button, Drawer, Field, Input, Select, Table } from '@sl/ui';
import { ArrowLeft, Table2 } from 'lucide-react';
import { useState } from 'react';
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
    if (!cur || String(cur['valid_from']) < from) best.set(k, r);
  }
  return [...best.values()];
}

function Detail({ t, onBack }: { t: BuiltinTable; onBack: () => void }) {
  const versions = versionsOf(t);
  const [at, setAt] = useState(versions.at(-1) ?? '');
  const i = versions.indexOf(at);
  const next = versions[i + 1];
  const rows = t.versioned ? rowsAt(t, at) : t.rows;
  return (
    <div className="flex flex-col gap-4">
      <Button
        size="sm"
        variant="ghost"
        className="w-fit"
        icon={<ArrowLeft size={16} aria-hidden="true" />}
        onClick={onBack}
      >
        All tables
      </Button>
      <h3 className="m-0 font-mono text-[16px] font-semibold">{t.name}</h3>
      <p className="m-0 text-[13px] text-muted">
        {t.description}. Key: <span className="font-mono">{t.key}</span>.
      </p>
      {t.versioned && (
        <>
          <Field label="Version valid from">
            <Select value={at} onChange={(e) => setAt(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v.slice(0, 10)} {hms(v)}
                </option>
              ))}
            </Select>
          </Field>
          {/* Board W13b: which events join this version. */}
          <p className="m-0 text-[13px] text-muted">
            {next
              ? `An event from ${hms(at)} up to ${hms(new Date(Date.parse(next) - 1000).toISOString())} joins these rows. One at ${hms(next)} or later sees the next version.`
              : `An event from ${hms(at)} on joins these rows (the latest version).`}
          </p>
        </>
      )}
      <Events rows={rows} label={`${t.name} rows`} empty="No rows." />
    </div>
  );
}

/**
 * DATA-03 reference tables (boards W13 list, W13b versioned table): the tables Lookup nodes join with. For now the
 * fintech pack's built-in tables (DATA-05), read-only.
 * ponytail: creating, editing and importing tables (rest of DATA-03) is the next slice.
 */
export function RefTablesButton() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const tables = Object.values(BUILTIN_TABLES).filter((t) => t.name.includes(q.trim().toLowerCase()));
  const picked = pick ? BUILTIN_TABLES[pick] : undefined;
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
          if (!o) setPick(null);
        }}
        title="Reference tables"
        size={560}
      >
        {picked ? (
          <Detail t={picked} onBack={() => setPick(null)} />
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Search tables">
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
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
