import { AppError, ErrorBanner, present } from '@sl/errors';
import { toFlinkSql } from '@sl/graph';
import { Button, Dialog, useToast } from '@sl/ui';
import { Copy, Download, FileCode2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { allTables, refCtx, useRefTables } from './refTables';
import { useGraph } from './store';

/** EXP-01: the pipeline as Flink SQL, recomputed when the graph or the reference tables change. */
export function useFlinkSql() {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const tables = useRefTables((s) => s.user);
  return useMemo(
    () =>
      toFlinkSql({ nodes, edges }, refCtx(), {
        // Versioned tables are joined as of the event time (their rows carry valid_from).
        versioned: Object.values(allTables())
          .filter((t) => t.versioned)
          .map((t) => t.name),
      }),
    // refCtx() and allTables() read the tables store: `tables` is what changes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, tables],
  );
}

/** Board W17: numbered, read-only SQL. A scroll region the keyboard can reach. */
export function SqlView({
  sql,
  fill = false,
}: {
  sql: string;
  /** In the run panel: no box of its own. */ fill?: boolean;
}) {
  const lines = sql.replace(/\n$/, '').split('\n');
  return (
    <div
      role="region"
      aria-label="Flink SQL"
      tabIndex={0}
      className={`sl-focus overflow-auto rounded-lg border border-line bg-subtle font-mono text-[12.5px] leading-[21px] ${fill ? '' : 'h-[240px]'}`}
    >
      <ol className="m-0 list-none py-2 pr-4 pl-0">
        {lines.map((l, i) => (
          <li key={i} className="flex">
            <span aria-hidden="true" className="w-10 shrink-0 pr-3 text-right text-muted select-none">
              {i + 1}
            </span>
            <code className="whitespace-pre text-ink">{l || ' '}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** EXPORT-UNSUPPORTED, one banner per node exported as a TODO. */
export function Unsupported({ nodes }: { nodes: { id: string; label: string }[] }) {
  return (
    <>
      {nodes.map((n) => (
        <ErrorBanner key={n.id} error={new AppError('EXPORT-UNSUPPORTED', { node: n.label })} />
      ))}
    </>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pipeline';

/**
 * Board W17 Export · Flink SQL: the generated SQL with Copy and Download .sql.
 * ponytail: "Run it for real" (EXP-02) and "Send to desktop" (EXP-03) are v1; they become tabs here.
 */
export function ExportButton() {
  const [open, setOpen] = useState(false);
  const name = useGraph((s) => s.name);
  const { sql, unsupported } = useFlinkSql();
  const toast = useToast();
  const failed = () => {
    const p = present(new AppError('COPY-FAILED'));
    toast({ severity: p.severity, message: p.message });
  };
  const copy = () => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip) return failed();
    clip.writeText(sql).then(() => toast({ severity: 'success', message: 'SQL copied' }), failed);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([sql], { type: 'application/sql' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(name)}.sql`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // after the browser has started the download
  };
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Export "${name}"`}
      width={720}
      trigger={
        <Button size="sm" variant="ghost" icon={<FileCode2 size={16} aria-hidden="true" />}>
          Export
        </Button>
      }
      footer={
        <>
          <Button icon={<Copy size={16} aria-hidden="true" />} onClick={copy}>
            Copy
          </Button>
          <Button variant="primary" icon={<Download size={16} aria-hidden="true" />} onClick={download}>
            Download .sql
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Unsupported nodes={unsupported} />
        <SqlView sql={sql} />
        <p className="m-0 text-[13px] text-muted">
          Generated for Flink 1.20 and 2.x. Connector options are placeholders.
        </p>
      </div>
    </Dialog>
  );
}
