import { describe, expect, it } from 'vitest';
import {
  exceptionHint,
  getExceptions,
  groupExceptions,
  recentFailures,
  rootCauseLine,
  splitCause,
} from './exceptions';
import type { FlinkHttp } from './http';

const entry = (ts: number, name: string, msg: string) => ({
  exceptionName: name,
  stacktrace: `${name}: ${msg}\n\tat org.example.Foo.bar(Foo.java:12)\n\tat ...`,
  timestamp: ts,
  taskName: 'Window aggregate (2/4)',
  endpoint: '10.0.4.27:41234',
  taskManagerId: 'tm-7',
  failureLabels: {},
  concurrentExceptions: [],
});
const body = {
  'root-exception': 'deprecated',
  exceptionHistory: {
    entries: [
      entry(9_000, 'java.lang.NullPointerException', 'merchant_id is null'),
      entry(5_000, 'java.io.IOException', 'Connection reset'),
    ],
    truncated: false,
  },
};
const answer =
  (b: unknown, status = 200): FlinkHttp =>
  async () => ({ status, headers: {}, url: '', body: JSON.stringify(b) });

describe('JOB-04 · exceptions (GET /jobs/:jid/exceptions, exceptionHistory)', () => {
  it('reads the history (not the deprecated root-exception) as Flink orders it (newest first), asking for at most 20', async () => {
    let req = { path: '', query: {} as Record<string, string> | undefined };
    const e = await getExceptions(
      async (r) => ((req = { path: r.path, query: r.query }), answer(body)(r)),
      'prod',
      'a/b',
    );
    expect(req.path).toBe('/jobs/a%2Fb/exceptions');
    expect(req.query).toEqual({ maxExceptions: '20' });
    expect(e.entries.map((x) => x.timestamp)).toEqual([9_000, 5_000]);
  });

  it('a global failure without task fields still reads', async () => {
    const g = { exceptionName: 'x.Y', stacktrace: 'x.Y: boom', timestamp: 1 };
    const e = await getExceptions(
      answer({ exceptionHistory: { entries: [g], truncated: false } }),
      'prod',
      'x',
    );
    expect(e.entries).toHaveLength(1);
  });

  it('root cause first line: the stack trace\'s first line ("Name: message"), for JOB-FAILED', () => {
    expect(rootCauseLine(entry(1, 'java.lang.NullPointerException', 'merchant_id is null'))).toBe(
      'java.lang.NullPointerException: merchant_id is null',
    );
    expect(rootCauseLine({ exceptionName: 'x.Y', stacktrace: '' })).toBe('x.Y');
  });

  it('a cause\'s own Suppressed block (indented "Caused by:", after it, as Java prints) is not the root', () => {
    const stacktrace = [
      'x.Wrap: outer',
      '\tat a',
      'Caused by: x.Root: disk full',
      '\tat b',
      '\tSuppressed: x.Close: close failed',
      '\t\tat c',
      '\t\tCaused by: x.Inner: not the root',
      '\t\t\t... 2 more',
    ].join('\n');
    expect(rootCauseLine({ exceptionName: 'x.Wrap', stacktrace })).toBe('x.Root: disk full');
  });

  it('audit #1: a wrapped failure gives the innermost "Caused by:", not the wrapper (Kafka fetcher example)', () => {
    const stacktrace = [
      'java.lang.RuntimeException: One or more fetchers have encountered exception',
      '\tat org.apache.flink.connector.base.source.reader.SourceReaderBase.pollNext(SourceReaderBase.java:179)',
      'Caused by: java.lang.RuntimeException: SplitFetcher thread 0 received unexpected exception',
      '\tat org.apache.flink.connector.base.source.reader.fetcher.SplitFetcher.run(SplitFetcher.java:168)',
      '\tSuppressed: java.io.IOException: close failed',
      '\t\tCaused by: java.lang.IllegalStateException: not the root',
      'Caused by: org.apache.kafka.common.errors.TopicAuthorizationException: Not authorized to access topics: [payments]',
      '\t... 6 more',
    ].join('\n');
    expect(rootCauseLine({ exceptionName: 'java.lang.RuntimeException', stacktrace })).toBe(
      'org.apache.kafka.common.errors.TopicAuthorizationException: Not authorized to access topics: [payments]',
    );
  });

  it('failures in a window (JOB-RESTARTING "restarted {n} times in {period}")', () => {
    const es = [entry(9_000, 'a', 'a'), entry(5_000, 'b', 'b'), entry(1_000, 'c', 'c')];
    expect(recentFailures(es, 10_000, 6_000)).toHaveLength(2);
  });

  it('API-404-JOB when the job is gone', async () => {
    await expect(
      getExceptions(answer({ errors: ['Job x not found'] }, 404), 'prod', 'x'),
    ).rejects.toMatchObject({
      code: 'API-404-JOB',
    });
  });
});

describe('JOB-08 · grouped exceptions (board X20)', () => {
  const ex = (ts: number, cause: string) => ({
    exceptionName: 'java.lang.RuntimeException',
    stacktrace: `java.lang.RuntimeException: wrapped\n\tat a\nCaused by: ${cause}\n\tat b`,
    timestamp: ts,
  });

  it('splits a cause line into its simple class name and message', () => {
    expect(splitCause('java.util.concurrent.TimeoutException: Kafka describeTopics')).toEqual({
      type: 'java.util.concurrent.TimeoutException',
      name: 'TimeoutException',
      message: 'Kafka describeTopics',
    });
    expect(splitCause('java.lang.NullPointerException')).toMatchObject({
      name: 'NullPointerException',
      message: '',
    });
    expect(splitCause('com.acme.ZahlungsFehlerÄ: kaputt')).toMatchObject({
      name: 'ZahlungsFehlerÄ',
      message: 'kaputt',
    });
    expect(splitCause('plain text, no class')).toMatchObject({ name: '', message: 'plain text, no class' });
    // audit #4: plain text is kept as it is (causeText's words before the refactor), trailing period included.
    expect(splitCause('No route to host.')).toMatchObject({ name: '', message: 'No route to host.' });
  });

  it('groups by root cause type and message, most frequent first, with count and first/last seen', () => {
    // audit #5: mixed order in, so the newest-first sort is really tested.
    const gs = groupExceptions([
      ex(200, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
      ex(100, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
      ex(250, 'java.lang.NullPointerException: ScoreFunction.map'),
      ex(300, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
    ]);
    expect(gs.map((g) => [g.name, g.message, g.count, g.first, g.last])).toEqual([
      ['TimeoutException', 'Kafka describeTopics', 3, 100, 300],
      ['NullPointerException', 'ScoreFunction.map', 1, 250, 250],
    ]);
    expect(gs[0]!.entries.map((e) => e.timestamp)).toEqual([300, 200, 100]); // each occurrence, newest first
  });

  it('numbers and ids in the message do not split a group (checkpoint 41 vs 42 expired)', () => {
    const gs = groupExceptions([
      ex(
        1,
        'org.apache.flink.runtime.checkpoint.CheckpointException: Checkpoint 41 expired before completing.',
      ),
      ex(
        2,
        'org.apache.flink.runtime.checkpoint.CheckpointException: Checkpoint 42 expired before completing.',
      ),
    ]);
    expect(gs).toHaveLength(1);
    expect(gs[0]!.count).toBe(2);
    expect(gs[0]!.message).toBe('Checkpoint 42 expired before completing'); // the newest one's words
  });

  it('a tie in count puts the most recent group first', () => {
    const gs = groupExceptions([ex(5, 'c.D: y'), ex(9, 'a.B: x')]);
    expect(gs.map((g) => g.name)).toEqual(['B', 'D']);
  });

  it('audit #1: same simple name, different classes, stay apart (java.util vs kafka TimeoutException)', () => {
    const gs = groupExceptions([
      ex(2, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
      ex(1, 'org.apache.kafka.common.errors.TimeoutException: Kafka describeTopics'),
    ]);
    expect(gs).toHaveLength(2);
  });

  it('audit #2: a UUID does not split a group', () => {
    const gs = groupExceptions([
      ex(2, 'a.E: task 12345678-beef-4abc-9def-0123456789ab failed'),
      ex(1, 'a.E: task 12345678-cafe-4abc-9def-0123456789ab failed'),
    ]);
    expect(gs).toHaveLength(1);
  });

  it('audit #3: different numbers that mean different problems stay apart (HTTP 401 vs 503)', () => {
    const gs = groupExceptions([
      ex(2, 'a.E: Request failed with status 401'),
      ex(1, 'a.E: Request failed with status 503'),
    ]);
    expect(gs).toHaveLength(2);
  });

  it.each([
    [
      'snapshot id',
      'a.E: Could not complete snapshot 17 for operator Window (2/4)#0.',
      'a.E: Could not complete snapshot 18 for operator Window (3/4)#1.',
    ],
    [
      'task suffix',
      "a.E: Task 'Source: payments (3/4)#2' failed",
      "a.E: Task 'Source: payments (1/4)#3' failed",
    ],
    [
      'Kafka expiry counts',
      'o.a.k.TimeoutException: Expiring 5 record(s) for payments-3:120001 ms has passed since batch creation',
      'o.a.k.TimeoutException: Expiring 7 record(s) for payments-3:120004 ms has passed since batch creation',
    ],
    [
      'TaskManager id',
      'a.JobMasterException: TaskManager with id 10.0.0.5:39231-a2b3c4 is no longer reachable.',
      'a.JobMasterException: TaskManager with id 10.0.0.7:41877-9f8e7d is no longer reachable.',
    ],
    [
      'execution attempt id',
      'a.E: Attempt 0a44b2c3d4e5f6a7b8c9d0e1f2a36227_cbc357ccb763df2852fee8c4fc7d55f2_0_1 failed',
      'a.E: Attempt 1b55c3d4e5f6a7b8c9d0e1f2a3b47338_cbc357ccb763df2852fee8c4fc7d55f2_2_0 failed',
    ],
  ])('audit 2: one problem with per-occurrence %s stays one group', (_, a, b) => {
    expect(groupExceptions([ex(2, a), ex(1, b)])).toHaveLength(1);
  });

  it.each([
    ['service ports', 'a.E: Connection refused: /10.0.0.5:9092', 'a.E: Connection refused: /10.0.0.5:8081'],
    ['a number inside a name', 'a.E: Topic orders-10s not found', 'a.E: Topic orders-60s not found'],
  ])('audit 3: different problems stay apart (%s)', (_, a, b) => {
    expect(groupExceptions([ex(2, a), ex(1, b)])).toHaveLength(2);
  });

  it('audit 3: a long whitespace run after an id word stays fast (no quadratic backtracking)', () => {
    const line = `a.E: task${' '.repeat(40_000)}x`;
    const t0 = performance.now();
    groupExceptions([ex(1, line)]);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('X20 exceptionHint', () => {
  it('the common causes, from the Flink docs; anything else none', () => {
    expect(
      exceptionHint(
        'org.apache.kafka.common.errors.TimeoutException',
        'Timed out waiting for describeTopics',
      ),
    ).toMatch(/brokers are unreachable from the TaskManagers/);
    expect(
      exceptionHint('java.util.concurrent.TimeoutException', 'Heartbeat of TaskManager timed out.'),
    ).toBeNull();
    expect(
      exceptionHint(
        'org.apache.flink.runtime.checkpoint.CheckpointException',
        'Checkpoint expired before completing.',
      ),
    ).toMatch(/checkpoint timeout/);
    expect(exceptionHint('java.lang.NullPointerException', '')).toMatch(/job's own code/);
    expect(exceptionHint('java.lang.OutOfMemoryError', 'Java heap space')).toMatch(/ran out of memory/);
    expect(exceptionHint('java.io.IOException', 'Stream closed')).toBeNull();
  });
});
