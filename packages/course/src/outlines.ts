/**
 * LEARN-02/03/05: chapters 1–6, at outline stage. The M5 prompt asks for each outline to be shown to Paramveer
 * before the full text is written: every section here is its title and the points it will make, and the page
 * shows them as a draft until `text` is written and approved. Challenges are complete (the checker needs them).
 * Section ids end with the challenge, as on board W05 ("Why windows · Tumbling · … · Challenge").
 */
export interface Section {
  id: string;
  title: string;
  /** The outline: what this section will say. */
  points: string[];
}
export interface Question {
  q: string;
  options: string[];
  /** Index into options. */
  answer: number;
  /** COURSE-WRONG's {hint}: what to look at, never the answer. */
  hint: string;
  /** Shown with "Correct." (board W05e). */
  why: string;
}
export interface ChapterContent {
  sections: Section[];
  /** Points to the simulator scenario the sandbox loads, by title (scenarios.ts). */
  sandbox: string;
  challenge: Question[];
  /** The completion dialog's line (board W05f): "You can now …". */
  learned: string;
}

export const CONTENT: Record<string, ChapterContent> = {
  'event-time': {
    learned:
      'You can now tell event time from processing time, and say why results depend on which one you count by.',
    sandbox: 'Late payments',
    sections: [
      {
        id: 'two-clocks',
        title: 'Two clocks',
        points: [
          'A payment carries the time it happened (event time); the pipeline sees it later (processing time).',
          'Networks, retries and offline card terminals make the gap vary from milliseconds to hours.',
        ],
      },
      {
        id: 'why-it-matters',
        title: 'Why it matters',
        points: [
          'Counting by processing time gives different answers on every replay; by event time, the same answer.',
          'Fraud rules ("5 payments in 1 minute") are about when payments happened, not when they arrived.',
        ],
      },
      {
        id: 'in-flink',
        title: 'In Flink SQL',
        points: [
          'A table declares its event-time column with a WATERMARK clause: that column becomes a time attribute.',
          'PROCTIME() is the processing-time alternative, and when it is the right choice.',
        ],
      },
    ],
    challenge: [
      {
        q: 'A payment made at 12:00:03 reaches the pipeline at 12:00:41. What is its event time?',
        options: ['12:00:41', '12:00:03', 'The time the window fires'],
        answer: 1,
        hint: 'event time is stamped where the payment happened, not where it is read',
        why: 'Event time is when it happened; the 38 s on the way is processing delay.',
      },
      {
        q: 'You replay yesterday’s payments. Which counts come out the same as yesterday?',
        options: ['Counts by processing time', 'Counts by event time', 'Neither'],
        answer: 1,
        hint: 'only one of the two clocks is stored in the data itself',
        why: 'Event time travels with the data, so a replay sees the same times again.',
      },
    ],
  },
  watermarks: {
    learned: 'You can now read a watermark, spot a late event and choose an out-of-orderness delay.',
    sandbox: 'Late payments',
    sections: [
      {
        id: 'what',
        title: 'What a watermark is',
        points: [
          'A watermark says "no event older than t is expected any more"; it only moves forward.',
          'Bounded out-of-orderness: watermark = highest event time seen − the allowed delay.',
        ],
      },
      {
        id: 'late',
        title: 'Late events',
        points: [
          'An event behind the watermark is late: a window it belonged to may have fired already.',
          'Flink SQL drops late rows for windows that have fired; the sandbox sends them to a late output to show them.',
        ],
      },
      {
        id: 'tuning',
        title: 'Choosing the delay',
        points: [
          'A longer delay means fewer late events but results that come later: the trade-off, in the sandbox.',
          'Idle sources hold the watermark back; the idle timeout lets it move on.',
        ],
      },
    ],
    challenge: [
      {
        q: 'The highest event time seen is 12:04:10 and the allowed out-of-orderness is 5 s. Where is the watermark?',
        options: ['12:04:15', '12:04:10', '12:04:05'],
        answer: 2,
        hint: 'the watermark trails the newest event by the allowed delay',
        why: '12:04:10 minus 5 s: the watermark trails the newest event by the allowed delay.',
      },
      {
        q: 'The watermark is at 12:05:02. An event stamped 12:04:58 arrives. What is it?',
        options: ['On time', 'Late', 'A duplicate'],
        answer: 1,
        hint: 'compare its event time with the black line, not with the clock',
        why: 'Its event time is behind the watermark, so it is late.',
      },
    ],
  },
  windows: {
    learned:
      'You can now explain tumbling, sliding and session windows, and why windows fire on the watermark.',
    sandbox: 'Card fraud bursts',
    sections: [
      {
        id: 'why',
        title: 'Why windows',
        points: [
          'A stream never ends, so "total payments" has no final answer; a window cuts it into finite pieces.',
        ],
      },
      {
        id: 'tumbling',
        title: 'Tumbling',
        points: [
          'Fixed size, no overlap: every event lands in exactly one window (TUMBLE).',
          'A window fires when the watermark passes its end, not when the wall clock does.',
        ],
      },
      {
        id: 'sliding',
        title: 'Sliding',
        points: [
          'Size and slide (HOP): windows overlap, so one event counts in several of them.',
          'Cumulating windows (CUMULATE), a relative: early results that grow step by step until the window ends.',
        ],
      },
      {
        id: 'session',
        title: 'Session',
        points: [
          'A session closes after a gap with no events (SESSION); its length depends on the data.',
          'Each key has its own sessions: one card can be in a session while another is not.',
        ],
      },
    ],
    challenge: [
      {
        q: 'A 12:00–12:05 window holds three payments. When does it fire?',
        options: [
          'It fires at 12:05 by the wall clock.',
          'It fires when the watermark passes 12:05.',
          'It fires when 5 events have arrived.',
        ],
        answer: 1,
        hint: 'Flink uses event time here; watch the black line in the sandbox, not the clock',
        why: 'The window closes when the watermark passes its end, so late clocks never matter.',
      },
      {
        q: 'A 10-minute window slides every 5 minutes. In how many windows is each payment counted?',
        options: ['1', '2', '5'],
        answer: 1,
        hint: 'divide the size by the slide',
        why: '10 minutes / 5 minutes: every payment falls in two overlapping windows.',
      },
    ],
  },
  aggregations: {
    learned: 'You can now aggregate per key and window, and keep the top N.',
    sandbox: 'Merchant top-N',
    sections: [
      {
        id: 'aggregates',
        title: 'Counts and sums',
        points: [
          'COUNT, SUM, AVG, MIN and MAX per key and window; the result is one row per key per window.',
        ],
      },
      {
        id: 'topn',
        title: 'Top-N',
        points: [
          'ROW_NUMBER() OVER (PARTITION BY window_start, window_end ORDER BY total DESC) with a filter on the rank.',
          'Inside a window the top 3 is final when the window fires; over a stream it is updated as it changes.',
        ],
      },
    ],
    challenge: [
      {
        q: 'Merchants are ranked by total per 5-minute window, keeping rank <= 3. How many rows can one window produce?',
        options: ['Exactly 3', 'At most 3', 'One per merchant'],
        answer: 1,
        hint: 'a quiet window may have fewer merchants than the limit',
        why: 'A window with only two merchants produces two rows.',
      },
    ],
  },
  deduplication: {
    learned: 'You can now drop duplicates, keeping the first or the latest copy.',
    sandbox: 'Card fraud bursts',
    sections: [
      {
        id: 'why',
        title: 'Why duplicates happen',
        points: ['Retries and at-least-once sources deliver the same payment twice.'],
      },
      {
        id: 'keep-first',
        title: 'Keep the first',
        points: [
          'ROW_NUMBER() OVER (PARTITION BY payment_id ORDER BY proc_time ASC) = 1 keeps the first to arrive and never changes it.',
          'ORDER BY must be a time attribute (otherwise it is a plain Top-N). Ordered by event time, keep-first can change: a copy with an earlier timestamp replaces the row.',
          'Keep the last instead: the result is updated each time a newer copy arrives.',
          'Keys are kept in state; state expiry (TTL) bounds it (chapter 7).',
        ],
      },
    ],
    challenge: [
      {
        q: 'Deduplicating on payment_id by processing time, keeping the first: a second copy arrives 3 minutes later. What happens?',
        options: ['It replaces the first', 'It is dropped', 'Both are kept'],
        answer: 1,
        hint: 'by processing time, keep-first never changes a row it has written',
        why: 'The first copy was written; later copies with the same key are dropped.',
      },
    ],
  },
  joins: {
    learned: 'You can now pick between regular, interval and versioned joins.',
    sandbox: 'Refunds matching',
    sections: [
      {
        id: 'regular',
        title: 'Regular joins',
        points: ['Both sides kept in state forever (unless TTL): correct, but state grows without bound.'],
      },
      {
        id: 'interval',
        title: 'Interval joins',
        points: [
          'A refund matches a payment only within a time bound (e.g. 7 days after it); state is freed as the watermark passes.',
        ],
      },
      {
        id: 'lookup',
        title: 'Versioned lookups',
        points: [
          'FOR SYSTEM_TIME AS OF joins each payment with the merchant row valid at its event time.',
          'A processing-time lookup reads whatever the table holds now: different answers on replay.',
        ],
      },
    ],
    challenge: [
      {
        q: 'Refunds join payments with an interval of 0 to 7 days. A refund comes 9 days after its payment. What does the join emit for it?',
        options: ['A matched row', 'No match', 'An error'],
        answer: 1,
        hint: 'check the refund’s time against the bounds of the interval',
        why: 'Nine days is outside the 7-day bound, so the pair is never matched (and its state is gone).',
      },
    ],
  },
};
