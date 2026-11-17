import { CHAPTERS, termById } from '@sl/course';
import { Button, Drawer } from '@sl/ui';
import { Lightbulb } from 'lucide-react';
import { useState } from 'react';

/**
 * JOB-10 / board D08f: "Explain" on a warning signal. A drawer with the course's own words for the concept
 * (packages/course glossary: never new copy), the chapter that teaches it when the course has one, and the Flink
 * docs page.
 * ponytail: D08f's bottleneck sentence and "What to try" list are Flink advice the handover does not supply
 * (MORNING); the chapter link opens nothing yet (the site's address is not decided): it names the chapter.
 * ponytail: the docs link is target=_blank, which a browser opens; the Tauri WebView needs the shell plugin's open
 * (an external link there is otherwise a dead click): wire it with the Tauri shell (MORNING).
 */
export function Explain({ term: id, label }: { term: string; label: string }) {
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
