import type { NodeType } from '@sl/graph';

/** Docs tab (NODES.md drawer tabs): what the node does in streaming terms, with fintech examples. */
export const NODE_DOCS: Record<NodeType, string[]> = {
  Source: [
    'A source reads a stream of events, such as payments from a topic. Each event carries its own event time.',
    'The watermark tells downstream windows how far event time has progressed: the latest event time seen, minus the out-of-orderness you allow. Events older than the watermark are late.',
  ],
  Generator: [
    'Seeded synthetic payments: the same seed always gives the same events, so runs are repeatable.',
    'Chaos settings add late, out-of-order, duplicate and malformed events so you can see how the pipeline copes.',
  ],
  Filter: [
    'Keeps the events for which the expression is true; the others go to the rejected output if it is connected.',
    'Expressions use CEL, e.g. amount > 1000.0 && currency == "AED".',
  ],
  Map: [
    'Adds or replaces fields computed from each event, and can drop fields. One event in, one event out.',
    'Example: amount_usd = amount * 0.27 for AED amounts.',
  ],
  Lookup: [
    'Joins each event with a reference table, such as merchants by merchant_id. With "as of event time", the version of the row that was valid at the event time is used (a versioned lookup).',
    'On a miss, the event can be dropped, passed through without the extra fields, or sent to the rejected output.',
  ],
  Join: [
    'Combines two streams on a key within a time interval, e.g. a refund with the payment it refunds within 30 days.',
    'Without an interval bound, both sides must be kept forever, so state grows without limit.',
  ],
  Window: [
    'Groups events by key into time windows and aggregates them, e.g. payments per card every 5 minutes.',
    'A window fires when the watermark passes its end. Allowed lateness keeps it open for late events a little longer; events later than that go to the late output.',
  ],
  'Top-N': [
    'Keeps the N largest events per group, e.g. the top 3 merchants by revenue each hour.',
    'Rankings change as events arrive: earlier results can be retracted and replaced.',
  ],
  Pattern: [
    'Detects a sequence of events per key, such as three declined payments followed by an approved one within 10 minutes (MATCH_RECOGNIZE). Available in v1.',
  ],
  Validate: [
    'Checks each event against named rules. Failing events go to the rejected output with the rule name, so bad data does not reach your results.',
  ],
  Deduplicate: [
    'Drops repeated events with the same key, keeping the first or the last. The TTL bounds how long keys are remembered; without it, state grows forever.',
  ],
  'Dead-letter': [
    'Collects rejected and late events with the reason, so you can inspect what went wrong instead of losing them silently.',
  ],
  Union: [
    'Merges two or more streams with the same fields into one, e.g. card payments and wallet payments. A source tag field records where each event came from.',
  ],
  Route: [
    'Sends each event to the first branch whose rule matches; events matching no rule go to the default branch, or are dropped when there is none.',
  ],
  Sink: [
    'Writes results to a topic or table. In the simulator, the Output tab shows what reached each sink.',
  ],
  SQL: ['Free SQL over the stream with DuckDB in the browser. Available in v1.'],
};
