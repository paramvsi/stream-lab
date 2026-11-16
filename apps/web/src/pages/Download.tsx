import { Banner, Button } from '@sl/ui';
import { Download as DownloadIcon } from 'lucide-react';
import { useState } from 'react';
import { detectOs, PLATFORMS, RELEASE, type Os } from './platforms';
import { REPO, SiteShell } from './SiteShell';

const nav = navigator as Navigator & { userAgentData?: { platform?: string } };

/**
 * LAND-03 download (boards W02 macOS, W02b Windows, W02c Linux): the detected platform's installer first, the
 * other two under it (picking one shows it instead). Before a release exists (RELEASE null) nothing is offered
 * to download: no file name, size or checksum is shown that does not exist.
 */
export function DownloadPage() {
  const [os, setOs] = useState<Os>(() => detectOs(nav.userAgentData?.platform, navigator.userAgent));
  const p = PLATFORMS[os];
  const file = RELEASE?.files[os];
  return (
    <SiteShell grid docTitle="Desktop app">
      <div className="flex flex-col items-center gap-4 pt-6 text-center">
        <p className="m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Desktop app</p>
        <h1 className="m-0 text-[44px] leading-[1.1] font-bold tracking-[-0.03em]">
          Stream Lab for {p.name}
        </h1>
        <p className="m-0 text-[17px] text-muted">
          Connect to any Apache Flink® cluster. Free, open source
          {RELEASE ? `, version ${RELEASE.version}.` : '.'}
        </p>
        <div className="flex gap-3 pt-2">
          {file ? (
            <a
              href={file.url}
              className="sl-focus inline-flex h-11 items-center gap-2 rounded-lg bg-rose-600 px-5 text-[15px] font-semibold text-white no-underline hover:bg-rose-700"
            >
              <DownloadIcon size={16} aria-hidden="true" />
              Download {p.ext}
            </a>
          ) : (
            <Button
              variant="primary"
              icon={<DownloadIcon size={16} aria-hidden="true" />}
              disabledReason="The desktop app has no release yet."
            >
              Download {p.ext}
            </Button>
          )}
          <a
            href={RELEASE ? RELEASE.notes : `${REPO}/releases`}
            className="sl-focus inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold text-ink no-underline hover:bg-subtle"
          >
            Release notes
          </a>
        </div>
        <p className="m-0 text-[13px] text-muted">
          {p.detail}
          {file && (
            <>
              {' · '}
              <span className="font-mono">{file.file}</span> · {file.size}
            </>
          )}
        </p>
        {!RELEASE && (
          <Banner severity="info" className="max-w-[760px] text-left">
            The desktop app is in development and has no release yet. Until then, the simulator and the course
            run in your browser.
          </Banner>
        )}
      </div>
      <section
        aria-labelledby="first-launch"
        className="mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-xl border border-line bg-subtle p-5"
      >
        <h2 id="first-launch" className="m-0 text-[15px] font-semibold">
          First launch
        </h2>
        <p className="m-0 text-[14px] text-muted">{p.firstLaunch}</p>
      </section>
      <section
        aria-labelledby="other"
        className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-3"
      >
        <h2 id="other" className="m-0 text-[15px] font-semibold">
          Other platforms
        </h2>
        <ul className="m-0 grid w-full list-none grid-cols-2 gap-3 p-0">
          {(Object.keys(PLATFORMS) as Os[])
            .filter((o) => o !== os)
            .map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => setOs(o)}
                  className="sl-focus flex w-full flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:bg-subtle"
                >
                  <span className="text-[16px] font-semibold text-ink">{PLATFORMS[o].name}</span>
                  <span className="text-[13px] text-muted">{PLATFORMS[o].detail}</span>
                </button>
              </li>
            ))}
        </ul>
      </section>
      {file && (
        <section aria-labelledby="checksums" className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
          <h2 id="checksums" className="m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
            Checksums
          </h2>
          <pre className="m-0 overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[13px]">
            sha256 {file.file}
            {'\n'}
            {file.sha256}
          </pre>
        </section>
      )}
    </SiteShell>
  );
}
