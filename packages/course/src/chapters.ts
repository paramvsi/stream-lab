/**
 * LEARN-05 the course, in order (titles and blurbs from boards W04*). Chapters 7–10 are v1: listed, not open.
 * minutes: the board's reading time; chapter 1 shows none on any board.
 */
export interface Chapter {
  id: string;
  n: number;
  title: string;
  blurb: string;
  minutes?: number;
  v1?: true;
}

export const CHAPTERS: Chapter[] = [
  { id: 'event-time', n: 1, title: 'Event time vs processing time', blurb: 'Two clocks, one stream' },
  {
    id: 'watermarks',
    n: 2,
    title: 'Watermarks and late events',
    blurb: 'How Flink decides time has passed',
    minutes: 14,
  },
  { id: 'windows', n: 3, title: 'Windows', blurb: 'Tumbling, sliding, session, cumulating', minutes: 18 },
  {
    id: 'aggregations',
    n: 4,
    title: 'Aggregations and Top-N',
    blurb: 'Counts, sums and the top 3 per window',
    minutes: 15,
  },
  {
    id: 'deduplication',
    n: 5,
    title: 'Deduplication',
    blurb: 'Drop the duplicates, keep the first',
    minutes: 10,
  },
  {
    id: 'joins',
    n: 6,
    title: 'Joins and lookups',
    blurb: 'Regular, interval and versioned lookups',
    minutes: 20,
  },
  { id: 'state', n: 7, title: 'State and state expiry', blurb: 'Keyed state and TTL', minutes: 16, v1: true },
  {
    id: 'patterns',
    n: 8,
    title: 'Pattern detection',
    blurb: 'Spot a fraud sequence with MATCH_RECOGNIZE',
    minutes: 18,
    v1: true,
  },
  {
    id: 'changelogs',
    n: 9,
    title: 'Changelogs and retractions',
    blurb: 'Why results get updated and retracted',
    minutes: 17,
    v1: true,
  },
  {
    id: 'checkpoints',
    n: 10,
    title: 'Checkpoints and backpressure',
    blurb: 'Barriers, exactly-once and full buffers',
    minutes: 22,
    v1: true,
  },
];

export type ChapterStatus = 'new' | 'started' | 'done';
export type Progress = Record<string, ChapterStatus>;

/** The chapter to offer next: the first open one not done (started or new); undefined when all are done. */
export function nextChapter(p: Progress): Chapter | undefined {
  return CHAPTERS.find((c) => !c.v1 && p[c.id] !== 'done');
}
