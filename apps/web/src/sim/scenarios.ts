import {
  newPipeline,
  spec,
  type NodeType,
  type Pipeline,
  type PipelineEdge,
  type PipelineNode,
} from '@sl/graph';

/** SIM-01 gallery: five fintech starters + blank (D22). Each is a valid pipeline (scenarios.test.ts). */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  tag: 'Fintech' | 'Blank';
  build: () => { nodes: PipelineNode[]; edges: PipelineEdge[] };
}

const GAP = 248;
function n(
  id: string,
  type: NodeType,
  col: number,
  row: number,
  config: object = {},
  label?: string,
): PipelineNode {
  return {
    id,
    type,
    position: { x: col * GAP, y: row * 104 },
    config: { ...(spec(type).defaults() as object), ...config },
    ...(label ? { label } : {}),
  };
}
function e(source: string, target: string, sourceHandle = 'main', targetHandle = 'main'): PipelineEdge {
  return {
    id: `e_${source}_${sourceHandle}_${target}_${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

const REFUNDS = [
  { name: 'refund_id', type: 'string', required: true },
  { name: 'payment_id', type: 'string', required: true },
  { name: 'amount', type: 'number', required: true },
  { name: 'event_time', type: 'timestamp', required: true },
] as const;

export const SCENARIOS: Scenario[] = [
  {
    id: 'blank',
    title: 'Blank pipeline',
    description: 'An empty canvas and the event generator.',
    tag: 'Blank',
    // W09 "empty canvas": nothing on it; the generator is the Data panel's (M3), not a node.
    build: () => ({ nodes: [], edges: [] }),
  },
  {
    id: 'fraud-bursts',
    title: 'Card fraud bursts',
    description: 'Payments per card in 5-minute windows; flag cards with a burst of spending.',
    tag: 'Fintech',
    build: () => ({
      nodes: [
        n('gen', 'Generator', 0, 1, {}, 'Payments'),
        n('val', 'Validate', 1, 1, {}, 'Rules'),
        n('win', 'Window', 2, 1, { sizeMs: 300000, keyBy: ['card_id'] }, 'Bursts per card'),
        n('flt', 'Filter', 3, 1, { expr: 'payments > 3' }, 'More than 3'),
        n('out', 'Sink', 4, 1, { name: 'fraud_alerts' }, 'Fraud alerts'),
        n('dlq', 'Dead-letter', 2, 2.5, {}, 'Rejected & late'),
      ],
      edges: [
        e('gen', 'val'),
        e('val', 'win'),
        e('win', 'flt'),
        e('flt', 'out'),
        e('val', 'dlq', 'rejected'),
        e('win', 'dlq', 'late'),
        e('flt', 'dlq', 'rejected'),
      ],
    }),
  },
  {
    id: 'refund-matching',
    title: 'Refunds matching',
    description: 'Match each refund to its payment within 30 days with an interval join.',
    tag: 'Fintech',
    build: () => ({
      nodes: [
        n('pay', 'Source', 0, 0, {}, 'Payments'),
        n('ref', 'Source', 0, 2, { name: 'refunds', schema: REFUNDS }, 'Refunds'),
        n(
          'join',
          'Join',
          1,
          1,
          { leftKey: 'payment_id', rightKey: 'payment_id', lowerMs: 0, upperMs: 30 * 86400000 },
          'Refund to payment',
        ),
        n('out', 'Sink', 2, 1, { name: 'matched_refunds' }, 'Matched refunds'),
      ],
      edges: [e('pay', 'join', 'main', 'left'), e('ref', 'join', 'main', 'right'), e('join', 'out')],
    }),
  },
  {
    id: 'card-velocity',
    title: 'Card velocity',
    description: 'Spend per card over a sliding 10 minutes; route high-velocity cards to review.',
    tag: 'Fintech',
    build: () => ({
      nodes: [
        n('gen', 'Generator', 0, 1, {}, 'Payments'),
        n(
          'win',
          'Window',
          1,
          1,
          {
            kind: 'hop',
            sizeMs: 600000,
            slideMs: 60000,
            aggregates: [{ fn: 'sum', field: 'amount', as: 'spent' }],
          },
          'Spend per card',
        ),
        n(
          'route',
          'Route',
          2,
          1,
          { routes: [{ id: 'high', name: 'high velocity', expr: 'spent > 5000' }] },
          'Velocity',
        ),
        n('review', 'Sink', 3, 0.5, { name: 'review_queue' }, 'Review queue'),
        n('ok', 'Sink', 3, 1.5, { name: 'normal' }, 'Normal'),
      ],
      edges: [
        e('gen', 'win'),
        e('win', 'route'),
        e('route', 'review', 'route-high'),
        e('route', 'ok', 'default'),
      ],
    }),
  },
  {
    id: 'merchant-top-n',
    title: 'Merchant top-N',
    description: 'Revenue per merchant each hour, and the top 3 merchants.',
    tag: 'Fintech',
    build: () => ({
      nodes: [
        n('gen', 'Generator', 0, 1, {}, 'Payments'),
        n(
          'win',
          'Window',
          1,
          1,
          {
            sizeMs: 3600000,
            keyBy: ['merchant_id'],
            aggregates: [{ fn: 'sum', field: 'amount', as: 'revenue' }],
          },
          'Revenue per merchant',
        ),
        n('top', 'Top-N', 2, 1, { partitionBy: [], orderBy: 'revenue', n: 3 }, 'Top 3'),
        n('out', 'Sink', 3, 1, { name: 'top_merchants' }, 'Top merchants'),
      ],
      edges: [e('gen', 'win'), e('win', 'top'), e('top', 'out')],
    }),
  },
  {
    id: 'late-payments',
    title: 'Late payments',
    description: 'Count payments per currency each minute and see which arrive after the watermark.',
    tag: 'Fintech',
    build: () => ({
      nodes: [
        n('src', 'Source', 0, 1, { outOfOrdernessMs: 2000 }, 'Payments'),
        n('win', 'Window', 1, 1, { sizeMs: 60000, keyBy: ['currency'] }, 'Per currency'),
        n('out', 'Sink', 2, 1, { name: 'per_currency' }, 'Per currency'),
        n('dlq', 'Dead-letter', 2, 2.5, {}, 'Late payments'),
      ],
      edges: [e('src', 'win'), e('win', 'out'), e('win', 'dlq', 'late')],
    }),
  },
];

/** A fresh pipeline from a scenario (new pipeline id; node ids are local to the pipeline). */
export function fromScenario(s: Scenario, id: string, now = new Date()): Pipeline & { scenario: string } {
  const { nodes, edges } = s.build();
  return {
    ...newPipeline(id, s.title === 'Blank pipeline' ? 'Untitled pipeline' : s.title, now),
    nodes,
    edges,
    scenario: s.tag,
  };
}
