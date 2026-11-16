import type { Trace, TraceHop } from '@sl/engine';
import { configOf, labelOf, type Graph } from '@sl/graph';

/**
 * EXPL-02 "Explain this run" (boards E01–E05): one output row's path through the pipeline, back to one source
 * event, told step by step with the values it really had. Built from the engine's lineage (RunOptions.trace).
 * A window result follows one of its events (the first), as board E01 does ("Payment c_4471 · 980.00 enters").
 */
export interface ExplainStep {
  node: string;
  title: string;
  text: string;
  hop: TraceHop | null;
}

const hms = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const num = (v: unknown) =>
  typeof v === 'number'
    ? v.toLocaleString(
        'en-US',
        Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
      )
    : String(v);
const money = (v: unknown) =>
  typeof v === 'number'
    ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v);

/** "Payment c_4471 · 980.00", or the first two fields of something else. */
function describe(d: Record<string, unknown>): string {
  if (d['card_id'] !== undefined && d['amount'] !== undefined)
    return `Payment ${d['card_id']} · ${money(d['amount'])}`;
  return Object.entries(d)
    .slice(0, 2)
    .map(([k, v]) => `${k} ${num(v)}`)
    .join(' · ');
}

export function explainPath(g: Graph, t: Trace, sink: string, row: number): ExplainStep[] {
  const id = t.outputs[sink]?.[row];
  if (id === undefined) return [];
  // Back from the row to a source event: the first parent each time.
  const chain: TraceHop[] = [];
  for (let h = t.hops.get(id); h; h = h.parents.length ? t.hops.get(h.parents[0]!) : undefined)
    chain.unshift(h);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const steps: ExplainStep[] = chain.map((h) => {
    const n = byId.get(h.node);
    const label = n ? labelOf(n) : h.node;
    const c = (n ? configOf(n) : {}) as Record<string, unknown>;
    if (h.port === 'late')
      return {
        node: h.node,
        hop: h,
        title: 'A late event is set aside',
        text: `A payment stamped ${hms(h.ts)} arrives after its window fired. Allowed lateness is ${Number(c['allowedLatenessMs'] ?? 0) / 1000} s, so it goes to the late output.`,
      };
    switch (n?.type) {
      case 'Source':
      case 'Generator':
        return {
          node: h.node,
          hop: h,
          title: 'An event arrives',
          text: `${describe(h.data)} enters from ${label} at event time ${hms(h.ts)}. ${
            h.ts > h.watermark
              ? 'It is on time.'
              : `The watermark is ${hms(h.watermark)}, so it is behind it.`
          }`,
        };
      case 'Validate': {
        const rules = (c['rules'] ?? []) as { name: string }[];
        return {
          node: h.node,
          hop: h,
          title: 'It passes the rules',
          text: `All ${rules.length} rule${rules.length === 1 ? '' : 's'} passed: ${rules.map((r) => r.name).join(', ')}.`,
        };
      }
      case 'Filter':
        return {
          node: h.node,
          hop: h,
          title: 'It passes the filter',
          text: `${String(c['expr'])} is true for it.`,
        };
      case 'Window': {
        const keys = (c['keyBy'] ?? []) as string[];
        // Sums and averages read as amounts (board E03 "total 1,940.00"); counts as whole numbers.
        const aggs = ((c['aggregates'] ?? []) as { fn: string; as: string }[]).map(
          (a) => `${a.as} ${a.fn === 'sum' || a.fn === 'avg' ? money(h.data[a.as]) : num(h.data[a.as])}`,
        );
        const start = Date.parse(String(h.data['window_start']));
        const end = Date.parse(String(h.data['window_end']));
        const who = keys.length ? ` for ${keys.map((k) => `${k} ${String(h.data[k])}`).join(', ')}` : '';
        return {
          node: h.node,
          hop: h,
          title: 'The window fires',
          text: `The watermark passes ${hms(end)}, so window ${hm(start)}–${hm(end)}${who} closes: ${aggs.join(', ')}.`,
        };
      }
      case 'Route': {
        const routes = (c['routes'] ?? []) as { id: string; name: string }[];
        const name =
          h.port === 'default' ? 'the default branch' : routes.find((r) => `route-${r.id}` === h.port)?.name;
        return {
          node: h.node,
          hop: h,
          title: `Routed to ${name ?? h.port}`,
          text: `${label} sends it to ${name ?? h.port}.`,
        };
      }
      case 'Lookup':
        return {
          node: h.node,
          hop: h,
          title: 'It is enriched',
          text: `Joined with ${String(c['table'])} on ${String(c['key'])} = ${String(h.data[String(c['key'])])}.`,
        };
      case 'Join':
        return {
          node: h.node,
          hop: h,
          title: 'It meets its match',
          text: `${label} joins it with an event from the other side.`,
        };
      case 'Deduplicate':
        return {
          node: h.node,
          hop: h,
          title: 'It is not a duplicate',
          text: `It is the ${String(c['keep'])} event for its key.`,
        };
      case 'Top-N':
        return {
          node: h.node,
          hop: h,
          title: `It ranks #${num(h.data['rank'])}`,
          text: `${label} keeps the top ${String(c['n'])}.`,
        };
      default:
        return {
          node: h.node,
          hop: h,
          title: label,
          text: `${label} passes it on${h.port === 'main' ? '' : ` (${h.port})`}.`,
        };
    }
  });
  const end = byId.get(sink);
  if (end) {
    const last = chain.at(-1);
    steps.push({
      node: sink,
      hop: null,
      title: `It reaches ${labelOf(end)}`,
      text: last?.reason
        ? `It is set aside: ${last.reason}.`
        : `${labelOf(end)} writes it as row ${row + 1}.`,
    });
  }
  return steps;
}
