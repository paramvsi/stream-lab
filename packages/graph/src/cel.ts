import { Environment, parse, ParseError } from '@marcbachmann/cel-js';
import type { Issue, Schema } from './types';

/**
 * CEL (NODE-03). @marcbachmann/cel-js, not the unscoped `cel-js`: that one has no type checker and drops error
 * positions, which CEL-TYPE and CEL-PARSE ("at column {c}") need (MORNING.md D32).
 */
const CEL_TYPE = {
  string: 'string',
  number: 'double',
  boolean: 'bool',
  timestamp: 'google.protobuf.Timestamp',
} as const;

export function celEnv(schema: Schema): Environment {
  const env = new Environment();
  for (const f of schema) env.registerVariable(f.name, CEL_TYPE[f.type]);
  return env;
}

/** Edit distance, for "did you mean" quick fixes (CEL-UNKNOWN-FIELD). */
export function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length]![b.length]!;
}

export function closest(name: string, options: string[]): string | undefined {
  const best = options.map((o) => [o, distance(name, o)] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= 2 ? best[0] : undefined;
}

export interface CelProblem extends Issue {
  /** Character range in the expression (for the inline squiggle). */
  from: number;
  to: number;
  /** Quick fix: replace from..to with this. */
  fix?: string;
}

const CEL_OUT: Record<string, string> = {
  bool: 'true/false',
  string: 'text',
  double: 'a number',
  int: 'a number',
  uint: 'a number',
  'google.protobuf.Timestamp': 'a timestamp',
};
const plain = (t: string) => CEL_OUT[t] ?? t;

/**
 * Check one expression against the input schema. `want`: the type it must return (Filter/Validate/Route: bool).
 * Returns null when fine, else CEL-PARSE / CEL-UNKNOWN-FIELD / CEL-TYPE with a range (and a quick fix when one exists).
 */
export function checkCel(
  expr: string,
  schema: Schema,
  want?: 'bool' | 'string' | 'double' | 'google.protobuf.Timestamp',
): CelProblem | null {
  // Nothing connected yet: the fields are unknown, so only the syntax can be checked.
  if (!schema.length) {
    try {
      parse(expr);
      return null;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      const x = e as unknown as { range?: { start: number; end: number }; summary?: string };
      const from = x.range?.start ?? 0;
      return {
        code: 'CEL-PARSE',
        params: { c: from + 1, reason: (x.summary ?? 'invalid expression').replace(/\.$/, '') },
        from,
        to: x.range?.end ?? expr.length,
      };
    }
  }
  const r = celEnv(schema).check(expr);
  if (r.valid) {
    if (want && r.type !== want && !(want === 'double' && (r.type === 'int' || r.type === 'uint')))
      return {
        code: 'CEL-TYPE',
        params: { expected: plain(want), actual: plain(r.type ?? 'unknown') },
        from: 0,
        to: expr.length,
      };
    return null;
  }
  const e = r.error as {
    code?: string;
    range?: { start: number; end: number };
    summary?: string;
    message: string;
  };
  const from = e.range?.start ?? 0;
  const to = e.range?.end ?? expr.length;
  if (e.code === 'unknown_variable') {
    const f = expr.slice(from, to);
    const names = schema.map((x) => x.name);
    const fix = closest(f, names);
    return {
      code: 'CEL-UNKNOWN-FIELD',
      params: { f, list: names.join(', ') || 'none' },
      from,
      to,
      ...(fix ? { fix } : {}),
    };
  }
  // Syntax and operator errors ("no such overload: double + string") read as expression errors at a column.
  let reason = (e.summary ?? e.message.split('\n')[0] ?? 'invalid expression').replace(/\.$/, '');
  // CEL does not mix decimals and whole numbers in arithmetic (amount * 2); say how to fix it.
  if (/no such overload: (double \S+ int|int \S+ double)/.test(reason))
    reason += ' (write 2.0 instead of 2 with decimal fields)';
  return { code: 'CEL-PARSE', params: { c: from + 1, reason }, from, to };
}
