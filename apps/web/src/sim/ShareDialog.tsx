import { AppError, ErrorBanner, present } from '@sl/errors';
import type { Pipeline } from '@sl/graph';
import { Button, Dialog, Field, Input, useToast } from '@sl/ui';
import { FileJson, Link2, Share2 } from 'lucide-react';
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

/** The uploaded rows of every Source that has some (for "Include uploaded data"). DATA-READ-FAILED if one can't
 * be read. */
async function uploadedRows(p: Pipeline): Promise<SharedRows> {
  const out: SharedRows = {};
  for (const [id, up] of Object.entries(p.data.uploads ?? {})) {
    let rows;
    try {
      rows = await loadRows(p.id, id);
    } catch (e) {
      throw new AppError('DATA-READ-FAILED', { file: up.file, reason: 'the browser could not read it' }, e);
    }
    if (rows) out[id] = rows;
  }
  return out;
}

/** What a link carries: without "Include uploaded data", nothing about the uploads (not even file names). */
function forLink(p: Pipeline, withData: boolean): Pipeline {
  if (withData) return p;
  const data = { ...p.data };
  delete data.uploads;
  return { ...p, data };
}

/**
 * EXP-04 Share dialog (board W18b; WX05 when the link is long): the whole pipeline in a link, nothing uploaded.
 * SHARE-TOO-LONG over 8,000 characters (under the link, as a field error), with Export JSON and Copy anyway in the
 * footer; switching uploaded data off is "Leave out data".
 */
export function ShareButton() {
  const [open, setOpen] = useState(false);
  const [withData, setWithData] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const toast = useToast();
  const checkId = useId();
  const hasUploads = useGraph((s) => Object.keys(s.data.uploads ?? {}).length > 0);
  // The link follows the pipeline and the switch while the dialog is open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const p = currentPipeline();
    void (withData ? uploadedRows(p) : Promise.resolve(undefined))
      .then((rows) => encodeShare(forLink(p, withData), rows))
      .then(
        (data) => live && setUrl(shareUrl(location.href, data)),
        (e: unknown) => {
          if (!(e instanceof AppError)) throw e;
          if (live) setError(e); // DATA-READ-FAILED, or SHARE-TOO-LONG when no link can hold it
        },
      );
    return () => {
      live = false;
      setUrl(null);
      setError(null);
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
  const tooBig = error?.code === 'SHARE-TOO-LONG'; // too big to open again: no link, JSON only
  const long = tooBig || (url !== null && url.length > SHARE_WARN_AT);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setWithData(false); // uploaded data is off each time (board W18b): sending it is a fresh choice
      }}
      title="Share pipeline"
      width={560}
      trigger={
        <Button size="sm" variant="ghost" icon={<Share2 size={16} aria-hidden="true" />}>
          Share
        </Button>
      }
      footer={
        long ? (
          <>
            <Button
              icon={<FileJson size={16} aria-hidden="true" />}
              onClick={() => downloadJson(currentPipeline())}
            >
              Export JSON
            </Button>
            {!tooBig && (
              <Button variant="primary" icon={<Link2 size={16} aria-hidden="true" />} onClick={copy}>
                Copy anyway
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="primary"
            icon={<Link2 size={16} aria-hidden="true" />}
            onClick={copy}
            {...(url ? {} : { disabledReason: error ? 'The link could not be made.' : 'Making the link…' })}
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
        {error && !tooBig && <ErrorBanner error={error} />}
        <Field
          label="Link"
          {...(long
            ? {
                error: `${present(tooBig ? error : new AppError('SHARE-TOO-LONG', { n: (url ?? '').length.toLocaleString('en-US') })).message}${withData ? ' Leave out uploaded data, or export a JSON file instead.' : ' Export a JSON file instead.'}`,
              }
            : {})}
        >
          <Input
            mono
            readOnly
            value={url ?? (error ? '' : 'Making the link…')}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <label htmlFor={checkId} className="flex items-center gap-2 text-[14px]">
          <input
            id={checkId}
            type="checkbox"
            role="switch"
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
