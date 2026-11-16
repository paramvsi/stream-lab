import { exportConnections, type Connection } from '@sl/flink';
import { Button, Dialog, IconButton, StatusBadge, Table } from '@sl/ui';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useScreenHeading } from './focus';

const ENV: Record<Connection['env'], string> = {
  prod: 'Production',
  staging: 'Staging',
  dev: 'Dev',
  none: '—',
};
const DOT: Record<NonNullable<Connection['color']> | Connection['env'], string> = {
  red: 'bg-danger-600',
  orange: 'bg-orange-500',
  green: 'bg-success-600',
  rose: 'bg-rose-500',
  grey: 'bg-muted',
  prod: 'bg-danger-600',
  staging: 'bg-orange-500',
  dev: 'bg-success-600',
  none: 'bg-muted',
};
const LOGIN: Record<Connection['auth']['type'], string> = {
  none: 'None',
  basic: 'User and password',
  bearer: 'Bearer token',
  'token-command': 'Token command',
  mtls: 'Client certificate',
};
/** host:port, as the board shows addresses (the scheme and path are in the connection). */
const shortAddress = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/**
 * CONN-08 / boards D03 (the list) and D03d (remove): the saved connections, Export (a file without secrets),
 * Add, and Remove behind a confirmation. Import is the next slice. ponytail: a Remove button per row instead of
 * the board's row menu (the kit has no menu component yet).
 */
export function Connections({
  connections,
  onAdd,
  onRemove,
}: {
  connections: Connection[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Connections · Stream Lab';
  }, []);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([exportConnections(connections)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'streamlab-connections.json',
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            Connections
          </h1>
          {/* Not the board's "Saved on this computer": until the storage and keychain land, that would be false. */}
          <p className="m-0 text-[14px] text-muted">
            Kept for this session only: saving to this computer and the keychain come with the desktop build.
          </p>
        </div>
        <div className="flex gap-3">
          <Button icon={<Upload size={16} aria-hidden="true" />} disabledReason="Importing is the next step.">
            Import
          </Button>
          <Button icon={<Download size={16} aria-hidden="true" />} onClick={exportFile}>
            Export
          </Button>
          <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={onAdd}>
            Add connection
          </Button>
        </div>
      </div>
      <Table
        label="Connections"
        rows={connections}
        rowKey={(c) => c.id}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (c) => (
              <span className="flex items-center gap-2 font-semibold">
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${DOT[c.color ?? c.env]}`}
                />
                {c.name}
              </span>
            ),
          },
          { key: 'address', header: 'Address', mono: true, render: (c) => shortAddress(c.url) },
          {
            key: 'env',
            header: 'Environment',
            render: (c) => (c.env === 'none' ? '—' : <StatusBadge tone="neutral">{ENV[c.env]}</StatusBadge>),
          },
          { key: 'login', header: 'Login', render: (c) => LOGIN[c.auth.type] },
          {
            key: 'mode',
            header: 'Mode',
            render: (c) => (c.readOnly ? <StatusBadge tone="info">Read-only</StatusBadge> : '—'),
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            render: (c) => (
              <IconButton aria-label={`Remove ${c.name}`} size="sm" onClick={() => setRemoving(c)}>
                <Trash2 size={16} aria-hidden="true" />
              </IconButton>
            ),
          },
        ]}
      />
      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove "${removing.name}"?` : ''}
        width={440}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) onRemove(removing.id);
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="m-0">This removes it from this computer. The cluster itself is not touched.</p>
      </Dialog>
    </main>
  );
}
