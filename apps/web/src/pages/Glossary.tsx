import { CHAPTERS, CONCEPT_LINK, searchTerms, termById, TERMS, type Term } from '@sl/course';
import { Drawer, EmptyState, Field, Input } from '@sl/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { ExternalLink, Search } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { SiteShell } from './SiteShell';

/** LEARN-04: the concept open in the drawer (W06d), from a chapter, the glossary or a related term. */
export const useConcept = create<{ id: string | null }>(() => ({ id: null }));
export const openConcept = (id: string) => useConcept.setState({ id });

const FLINK_DOCS = 'https://nightlies.apache.org/flink/flink-docs-stable/';
const linkCls =
  'sl-focus rounded-sm font-medium text-rose-700 underline underline-offset-2 hover:text-rose-600';

/** A concept link in text: opens the drawer, without leaving the page. */
export function ConceptLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button type="button" className={`${linkCls} cursor-pointer`} onClick={() => openConcept(id)}>
      {children}
    </button>
  );
}

/** Text with `[[term-id|words]]` concept links (outlines.ts). */
export function WithConcepts({ text }: { text: string }) {
  const parts = text.split(CONCEPT_LINK);
  return (
    <>
      {parts.map((p, i) =>
        // An id that is not a term stays plain words (glossary.test checks every link resolves).
        i % 3 === 1 && termById(p) ? (
          <ConceptLink key={i} id={p}>
            {parts[i + 1]}
          </ConceptLink>
        ) : i % 3 === 1 ? (
          <Fragment key={i}>{parts[i + 1]}</Fragment>
        ) : i % 3 === 2 ? null : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** W06d: the concept drawer, over whatever page opened it. */
export function ConceptDrawer() {
  const id = useConcept((s) => s.id);
  // A concept belongs to the page that opened it: Back, Forward or a link elsewhere closes it.
  const path = useRouterState({ select: (r) => r.location.pathname });
  useEffect(() => useConcept.setState({ id: null }), [path]);
  const t = id ? termById(id) : undefined;
  const chapter = t?.chapter ? CHAPTERS.find((c) => c.id === t.chapter) : undefined;
  return (
    <Drawer
      open={!!t}
      onOpenChange={(o) => !o && useConcept.setState({ id: null })}
      title="Concept"
      side="right"
      size={480}
    >
      {t && (
        <div className="flex flex-col gap-4">
          <p className="m-0 font-mono text-[12px] text-rose-700">CONCEPT</p>
          <h3 className="m-0 text-[24px] font-bold">{t.name}</h3>
          <p className="m-0 text-[15px] leading-relaxed">{t.body}</p>
          {t.sql && (
            <>
              <h4 className="m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
                Flink SQL
              </h4>
              <pre className="m-0 overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[13px]">
                {t.sql}
              </pre>
            </>
          )}
          {t.related.length > 0 && (
            <>
              <h4 className="m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Related</h4>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {t.related.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => openConcept(r)}
                      className="sl-focus rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-ink hover:bg-subtle"
                    >
                      {termById(r)?.name ?? r}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="m-0 flex gap-5 text-[15px]">
            {chapter && (
              <Link
                to="/learn/$chapter"
                params={{ chapter: chapter.id }}
                className={linkCls}
                onClick={() => useConcept.setState({ id: null })}
              >
                Open chapter {chapter.n}
              </Link>
            )}
            <a href={t.docs} className={linkCls}>
              Flink docs
            </a>
          </p>
        </div>
      )}
    </Drawer>
  );
}

/** LEARN-04 the glossary (boards W06 index, W06b search, W06c no results). */
export function Glossary() {
  const [q, setQ] = useState('');
  const found = searchTerms(q);
  const searching = q.trim() !== '';
  const letters = new Set(TERMS.map((t) => t.name[0]!.toUpperCase()));
  return (
    <SiteShell narrow eyebrow="Glossary" title="Flink concepts, in plain words">
      <div className="w-[560px] max-w-full">
        <Field label="Search the glossary">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search terms like watermark or state"
          />
        </Field>
      </div>
      {/* Always there (empty when not searching), so the first count is announced too. */}
      <p role="status" className={searching ? 'm-0 text-[14px] text-muted' : 'sr-only'}>
        {searching ? `${found.length} ${found.length === 1 ? 'result' : 'results'}` : ''}
      </p>
      {!searching && (
        <nav aria-label="Letters" className="flex flex-wrap gap-x-4 font-mono text-[13px]">
          {[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) =>
            letters.has(l) ? (
              // A button: under hash routing an href="#letter-S" would be the route /letter-S.
              <button
                key={l}
                type="button"
                aria-label={`Terms starting with ${l}`}
                onClick={() => {
                  const el = document.getElementById(`letter-${l}`);
                  el?.scrollIntoView();
                  el?.focus();
                }}
                className="sl-focus rounded-sm text-ink hover:text-rose-700"
              >
                {l}
              </button>
            ) : (
              <span key={l} aria-hidden="true" className="text-muted">
                {l}
              </span>
            ),
          )}
        </nav>
      )}
      {found.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`No concept matches "${q.trim()}"`}
          level={2}
          actions={
            <a
              href={FLINK_DOCS}
              className="sl-focus inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold text-ink no-underline hover:bg-subtle"
            >
              <ExternalLink size={16} aria-hidden="true" />
              Open the Flink docs
            </a>
          }
        >
          Stream Lab covers Flink concepts. Try &ldquo;source&rdquo; or &ldquo;sink&rdquo;, or search the
          Flink docs.
        </EmptyState>
      ) : (
        <ul aria-label="Concepts" className="m-0 grid list-none grid-cols-2 gap-3 p-0">
          {found.map((t, i) => (
            <Card key={t.id} t={t} first={!searching && found[i - 1]?.name[0] !== t.name[0]} />
          ))}
        </ul>
      )}
    </SiteShell>
  );
}

function Card({ t, first }: { t: Term; first: boolean }) {
  const letter = t.name[0]!.toUpperCase();
  return (
    <li
      id={first ? `letter-${letter}` : undefined}
      tabIndex={first ? -1 : undefined}
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
    >
      <button
        type="button"
        onClick={() => openConcept(t.id)}
        className="sl-focus flex h-full w-full flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-4 text-left hover:border-rose-100 hover:bg-subtle"
      >
        <span className="text-[16px] font-semibold text-ink">{t.name}</span>
        <span className="text-[14px] text-muted">{t.short}</span>
      </button>
    </li>
  );
}
