import { AppError, ErrorBanner } from '@sl/errors';
import { BANDS, bandOf, CAPABILITIES, type CapSupport } from '@sl/flink';
import { Check, Minus, X } from 'lucide-react';
import type { ReactNode } from 'react';

const WORD: Record<CapSupport, { text: string; icon: ReactNode }> = {
  yes: { text: 'Yes', icon: <Check size={14} aria-hidden="true" className="text-success-600" /> },
  partial: { text: 'Partial', icon: <Minus size={14} aria-hidden="true" className="text-orange-700" /> },
  no: { text: 'No', icon: <X size={14} aria-hidden="true" className="text-muted" /> },
};

/**
 * CONN-07 / board C05: what works on this cluster. Every band's column, the cluster's own marked ("This
 * cluster", not colour alone); an old version says so first (CONN-VERSION-OLD). Each cell is an icon and a word.
 */
export function VersionCapabilities({ version }: { version: string }) {
  const band = bandOf(version);
  return (
    <div className="flex flex-col gap-4">
      {band === 'old' && <ErrorBanner error={new AppError('CONN-VERSION-OLD', { version })} />}
      {band === 'unknown' && (
        <p className="m-0 text-[14px]">
          The cluster's version could not be read (it says “{version}”), so no column is marked.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <caption className="sr-only">What works on Flink {version}, by version</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2 pr-4 font-semibold">
                Feature
              </th>
              {BANDS.map((b) => (
                <th
                  key={b.band}
                  scope="col"
                  className={`px-3 py-2 font-semibold ${b.band === band ? 'bg-rose-50' : ''}`}
                >
                  {b.label}
                  {b.band === band && (
                    <span className="block text-[12px] font-normal text-rose-700">This cluster</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((f) => (
              <tr key={f.id} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {f.label}
                </th>
                {BANDS.map((b) => (
                  <td key={b.band} className={`px-3 py-2 ${b.band === band ? 'bg-rose-50' : ''}`}>
                    <span className="inline-flex items-center gap-1.5">
                      {WORD[f.support[b.band]].icon}
                      {WORD[f.support[b.band]].text}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
