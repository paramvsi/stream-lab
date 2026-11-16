/**
 * LEARN-04 the glossary (boards W06, W06b, W06c, W06d): the terms on the board, each with a one-line summary
 * (the card), a longer definition (the concept drawer), optional Flink SQL, related terms, the chapter that
 * teaches it and the Flink docs page. Search covers names and aliases.
 * docs: the stable Flink docs. // FLINK: https://nightlies.apache.org/flink/flink-docs-stable/
 */
export interface Term {
  id: string;
  name: string;
  aliases: string[];
  short: string;
  body: string;
  sql?: string;
  related: string[];
  /** The chapter id that teaches it. */
  chapter?: string;
  docs: string;
}

const DOCS = 'https://nightlies.apache.org/flink/flink-docs-stable/docs';

export const TERMS: Term[] = [
  {
    id: 'allowed-lateness',
    name: 'Allowed lateness',
    aliases: ['lateness', 'late data'],
    short: 'How long a window waits for late events after it fires.',
    body: 'After a window fires, events for it can still arrive. Allowed lateness keeps the window around for that long: a late event updates the result instead of being dropped. Later still, it is dropped (or sent to a side output).',
    related: ['watermark', 'event-time'],
    chapter: 'watermarks',
    docs: `${DOCS}/dev/datastream/operators/windows/#allowed-lateness`,
  },
  {
    id: 'backpressure',
    name: 'Backpressure',
    aliases: ['back pressure', 'slow operator'],
    short: 'A slow operator makes everything upstream slow down.',
    body: 'When an operator can not keep up, its input buffers fill, and the operators feeding it have to wait. The slowness travels upstream to the sources, which read less.',
    related: ['checkpoint'],
    docs: `${DOCS}/ops/monitoring/back_pressure/`,
  },
  {
    id: 'checkpoint',
    name: 'Checkpoint',
    aliases: ['snapshot', 'exactly-once'],
    short: 'A consistent snapshot of all state, taken automatically.',
    body: 'Flink regularly takes a consistent snapshot of every operator’s state and the sources’ positions. After a failure, the job restarts from the last one, so each event affects the state exactly once.',
    related: ['savepoint', 'backpressure'],
    docs: `${DOCS}/concepts/stateful-stream-processing/#checkpointing`,
  },
  {
    id: 'event-time',
    name: 'Event time',
    aliases: ['rowtime', 'time attribute'],
    short: 'The time an event happened, carried in the event.',
    body: 'Event time is the timestamp in the event itself: when the payment was made, not when the pipeline read it. Results computed on event time are the same on every replay.',
    sql: "WATERMARK FOR ts AS ts - INTERVAL '5' SECOND",
    related: ['watermark', 'processing-time'],
    chapter: 'event-time',
    docs: `${DOCS}/concepts/time/`,
  },
  {
    id: 'idle-source',
    name: 'Idle source',
    aliases: ['idleness', 'idle partition', 'idle timeout'],
    short: 'A source with no events that would hold the watermark back.',
    body: 'The watermark is the smallest of its inputs’ watermarks, so a source that sends nothing stops it. Marking a source idle after a timeout lets the watermark move on without it.',
    related: ['watermark'],
    chapter: 'watermarks',
    docs: `${DOCS}/dev/datastream/event-time/generating_watermarks/#dealing-with-idle-sources`,
  },
  {
    id: 'key-group',
    name: 'Key group',
    aliases: ['max parallelism', 'keyed state'],
    short: 'The unit Flink uses to spread keyed state over subtasks.',
    body: 'Each key hashes to one of a fixed number of key groups (the max parallelism), and each subtask owns a range of them. Rescaling moves whole key groups, so a key’s state always moves with it.',
    related: ['checkpoint'],
    docs: `${DOCS}/concepts/stateful-stream-processing/#keyed-state`,
  },
  {
    id: 'processing-time',
    name: 'Processing time',
    aliases: ['proctime', 'wall clock'],
    short: 'The time on the machine when an event is processed.',
    body: 'Processing time is the clock of the machine running the operator. It needs no watermarks, but results depend on when the job ran, so a replay can give different answers.',
    sql: 'proc_time AS PROCTIME()',
    related: ['event-time'],
    chapter: 'event-time',
    docs: `${DOCS}/concepts/time/`,
  },
  {
    id: 'savepoint',
    name: 'Savepoint',
    aliases: ['upgrade', 'stop with savepoint'],
    short: 'A checkpoint you trigger and keep, for upgrades.',
    body: 'A savepoint is a snapshot of the job’s state that you trigger yourself and that Flink does not delete. Stop a job with a savepoint, change or upgrade it, and start the new version from there.',
    related: ['checkpoint'],
    docs: `${DOCS}/ops/state/savepoints/`,
  },
  {
    id: 'session-window',
    name: 'Session window',
    aliases: ['session', 'gap'],
    short: 'A window that closes after a gap of inactivity.',
    body: 'A session window groups a key’s events until no event arrives for the gap. Its length depends on the data: a busy card has long sessions, a quiet one short ones.',
    sql: "SESSION(TABLE payments PARTITION BY card_id, DESCRIPTOR(ts), INTERVAL '10' MINUTES)",
    related: ['watermark'],
    chapter: 'windows',
    docs: `${DOCS}/dev/table/sql/queries/window-tvf/#session`,
  },
  {
    id: 'sink',
    name: 'Sink',
    aliases: ['output', 'connector'],
    short: 'Where a pipeline writes its results.',
    body: 'A sink is a table the pipeline writes to through a connector: a Kafka topic, a database table, files. An INSERT INTO statement sends a query’s rows to it.',
    related: ['source'],
    docs: `${DOCS}/connectors/table/overview/`,
  },
  {
    id: 'source',
    name: 'Source',
    aliases: ['input', 'connector'],
    short: 'Where a pipeline reads its events from.',
    body: 'A source is a table the pipeline reads through a connector: a Kafka topic, files, a database’s changes. Its event-time column and watermark are declared on the table.',
    related: ['sink', 'event-time', 'watermark'],
    docs: `${DOCS}/connectors/table/overview/`,
  },
  {
    id: 'watermark',
    name: 'Watermark',
    aliases: ['wm', 'event time progress'],
    short: 'Flink’s estimate of how far event time has progressed.',
    body: 'A watermark is Flink’s estimate of how far event time has progressed. A watermark of 12:04:07 says: “I don’t expect any more events earlier than 12:04:07.” Events behind the watermark are late. Windows fire when the watermark passes their end.',
    sql: "WATERMARK FOR ts AS ts - INTERVAL '5' SECOND",
    related: ['event-time', 'allowed-lateness', 'idle-source'],
    chapter: 'watermarks',
    docs: `${DOCS}/concepts/time/`,
  },
];

export const termById = (id: string) => TERMS.find((t) => t.id === id);

/** W06b: terms whose name or an alias contains the query (case and accents ignored), names first. */
export function searchTerms(q: string): Term[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const n = norm(q.trim());
  if (!n) return TERMS;
  const byName = TERMS.filter((t) => norm(t.name).includes(n));
  const byAlias = TERMS.filter((t) => !byName.includes(t) && t.aliases.some((a) => norm(a).includes(n)));
  return [...byName, ...byAlias];
}
