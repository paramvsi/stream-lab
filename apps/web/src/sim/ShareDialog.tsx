import { AppError, ErrorBanner, present } from '@sl/errors';
import type { Pipeline } from '@sl/graph';
import { Button, Dialog, Field, Input, useToast } from '@sl/ui';
import { Link2, Share2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { downloadJson, encodeShare, SHARE_WARN_AT, shareUrl, type SharedRows } from '../share';
import { useGraph } from './store';
import { loadRows } from './uploads';

/** The open pipeline as it is now (what a share link or a JSON file carries). */
export function currentPipeline(): Pipeline {
  const g = useGraph.getState();
  return {
    schemaVersion: 1,
    id: g.pipelineId,
    name: g.name,
    updatedAt: new Date().toISOString(),
    seed: g.seed,
    nodes: g.nodes,
    edges: g.edges,
    data: g.data,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** The uploaded rows of every Source that has some (for "Include uploaded data"). */
async function uploadedRows(p: Pipeline): Promise<SharedRows> {
  const out: SharedRows = {};
  for (const id of Object.keys(p.data.uploads ?? {})) {
    const rows = await loadRows(p.id, id);
    if (rows) out[id] = rows;
  }
  return out;
}

/**
 * EXP-04 Share dialog (board W18b; WX05 when the link is long): the whole pipeline in a link, nothing uploaded.
 * SHARE-TOO-LONG over 8,000 characters, with "Leave out data", "Export JSON" and "Copy anyway".
 */
export function ShareButton() {
  const [open, setOpen] = useState(false);
  const [withData, setWithData] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const toast = useToast();
  const checkId = useId();
  const hasUploads = useGraph((s) => Object.keys(s.data.uploads ?? {}).length > 0);
  // The link follows the pipeline and the checkbox while the dialog is open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const p = currentPipeline();
    void (withData ? uploadedRows(p) : Promise.resolve(undefined))
      .then((rows) => encodeShare(p, rows))
      .then((data) => live && setUrl(shareUrl(location.href, data)));
    return () => {
      live = false;
      setUrl(null);
    };
  }, [open, withData]);
  const copy = () => {
    const failed = () => {
      const p = present(new AppError('COPY-FAILED'));
      toast({ severity: p.severity, message: p.message });
    };
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip || !url) return failed();
    clip.writeText(url).then(() => toast({ severity: 'success', message: 'Link copied' }), failed);
  };
  const long = url !== null && url.length > SHARE_WARN_AT;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Share pipeline"
      trigger={
        <Button size="sm" variant="ghost" icon={<Share2 size={16} aria-hidden="true" />}>
          Share
        </Button>
      }
      footer={
        long ? undefined : (
          <Button
            variant="primary"
            icon={<Link2 size={16} aria-hidden="true" />}
            onClick={copy}
            {...(url ? {} : { disabledReason: 'Making the link…' })}
          >
            Copy link
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-muted">
          The whole pipeline travels in the link, after the #. Nothing is uploaded.
        </p>
        <Field label="Link">
          <Input mono readOnly value={url ?? 'Making the link…'} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        {long && (
          <ErrorBanner
            error={new AppError('SHARE-TOO-LONG', { n: url.length.toLocaleString('en-US') })}
            onAction={(a) => {
              if (a === 'Leave out data') setWithData(false);
              else if (a === 'Export JSON') downloadJson(currentPipeline());
              else if (a === 'Copy anyway') copy();
            }}
          />
        )}
        <label htmlFor={checkId} className="flex items-center gap-2 text-[14px]">
          <input
            id={checkId}
            type="checkbox"
            className="sl-focus"
            checked={withData}
            disabled={!hasUploads}
            onChange={(e) => setWithData(e.target.checked)}
          />
          Include uploaded data
          {!hasUploads && <span className="text-[13px] text-muted">(no uploaded files)</span>}
        </label>
      </div>
    </Dialog>
  );
}
