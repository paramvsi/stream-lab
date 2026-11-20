import { CHAPTERS, termById } from '@sl/course';
import { Button, Drawer } from '@sl/ui';
import { Lightbulb } from 'lucide-react';
import { useState } from 'react';

/**
 * JOB-10 / board D08f: "Explain" on a warning signal. A drawer with the course's own words for the concept
 * (packages/course glossary: never new copy), the chapter that teaches it when the course has one, and the Flink
 * docs page.
 * `tries`: D08f's "What to try" (ruled 2026-11-18: short hints from the Flink docs, worded by the caller).
 * ponytail: the chapter link opens nothing yet (the site's address is not decided): it names the chapter.
 * ponytail: the docs link is target=_blank, which a browser opens; the Tauri WebView needs the shell plugin's open
 * (an external link there is otherwise a dead click): wire it with the Tauri shell (MORNING).
 */
export function Explain({ term: id, label, tries = [] }: { term: string; label: string; tries?: string[] }) {
  const [open, setOpen] = useState(false);
  const term = termById(id);
  if (!term) return null;
  const chapter = term.chapter ? CHAPTERS.find((c) => c.id === term.chapter) : undefined;
  return (
    <>
      <Button size="sm" icon={<Lightbulb size={16} aria-hidden="true" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} title={term.name}>
        <div className="flex flex-col gap-3 text-[14px]">
          <p className="m-0 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Concept · from the course
          </p>
          <p className="m-0">{term.body}</p>
          {tries.length > 0 && (
            <>
              <h3 className="m-0 mt-2 text-[14px] font-semibold">What to try</h3>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {tries.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {chapter && <p className="m-0 text-muted">In the course: {chapter.title}</p>}
          <a
            href={term.docs}
            target="_blank"
            rel="noreferrer"
            className="sl-focus w-fit text-rose-700 underline"
          >
            Flink docs: {term.name}
          </a>
        </div>
      </Drawer>
    </>
  );
}
