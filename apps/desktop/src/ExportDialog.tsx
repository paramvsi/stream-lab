import { exportConnections, type Connection } from '@sl/flink';
import { Button, Dialog } from '@sl/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';

/**
 * CONN-08 export (board D03c): which connections go into the file (each on by default), then Save file. The file
 * never holds tokens, passwords or keys (exportConnections). ponytail: saved with an <a download> on a blob URL,
 * which works in a browser; the Tauri build saves with the dialog and fs plugins instead (MORNING).
 */
export function ExportDialog({
  open,
  onOpenChange,
  connections,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connections: Connection[];
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = connections.filter((c) => !off.has(c.id));
  const save = () => {
    const url = URL.createObjectURL(new Blob([exportConnections(chosen)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'streamlab-connections.json',
    });
    a.click();
    // Revoked a moment later: some engines cancel a download whose URL is revoked straight after the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export connections"
      width={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Download size={16} aria-hidden="true" />}
            onClick={save}
            {...(chosen.length ? {} : { disabledReason: 'Choose at least one connection.' })}
          >
            Save file
          </Button>
        </>
      }
    >
      <p className="m-0">
        Exports names, addresses and settings as JSON. Tokens, passwords and keys are never exported.
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {connections.map((c) => (
          <li key={c.id}>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-2.5">
              <span className="font-semibold">{c.name}</span>
              <input
                type="checkbox"
                role="switch"
                className="sl-focus size-5 accent-rose-600"
                checked={!off.has(c.id)}
                onChange={(e) =>
                  setOff((x) => {
                    const n = new Set(x);
                    if (e.target.checked) n.delete(c.id);
                    else n.add(c.id);
                    return n;
                  })
                }
              />
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
