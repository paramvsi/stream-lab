import { CHAPTERS } from '@sl/course';
import { NotFound } from './NotFound';
import { SiteShell } from './SiteShell';

/**
 * LEARN-02 a chapter (boards W05*): reading, a sandbox and a challenge.
 * ponytail: the title only until the chapter layout lands (next M5 slice); the text waits for the outlines'
 * review (M5 prompt: "show each chapter outline before writing the full text").
 */
export function ChapterPage({ id }: { id: string }) {
  const c = CHAPTERS.find((x) => x.id === id && !x.v1);
  if (!c) return <NotFound />;
  return (
    <SiteShell narrow eyebrow={`Chapter ${c.n}`} title={c.title} lede={c.blurb}>
      {null}
    </SiteShell>
  );
}
