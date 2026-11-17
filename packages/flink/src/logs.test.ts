import { describe, expect, it } from 'vitest';
import type { FlinkRequest } from './http';
import {
  filterLines,
  getJmLog,
  getTmLog,
  LOG_TAIL_LINES,
  listJmLogs,
  listTmLogs,
  tail,
  tooLarge,
} from './logs';

const reply = (status: number, body: string) => async () => ({ status, headers: {}, url: '', body });

describe('OPS-01 · logs (D18)', () => {
  it('listJmLogs: {logs:[{name,size,mtime}]}, newest first', async () => {
    let path = '';
    const l = await listJmLogs(
      async (r: FlinkRequest) => (
        (path = r.path),
        reply(
          200,
          JSON.stringify({
            logs: [
              { name: 'jobmanager.log.1', size: 10, mtime: 100 },
              { name: 'jobmanager.log', size: 20, mtime: 200 },
            ],
          }),
        )()
      ),
      'prod',
    );
    expect(path).toBe('/jobmanager/logs');
    expect(l.map((x) => x.name)).toEqual(['jobmanager.log', 'jobmanager.log.1']);
  });

  it('getJmLog: the file as text (encoded name); a missing one is LOG-GONE, never raw', async () => {
    let path = '';
    expect(
      await getJmLog(async (r) => ((path = r.path), reply(200, 'a\nb\n')()), 'prod', 'job manager.log'),
    ).toBe('a\nb\n');
    expect(path).toBe('/jobmanager/logs/job%20manager.log');
    await expect(
      getJmLog(reply(404, '{"errors":["This file does not exist in JobManager log dir."]}'), 'prod', 'x'),
    ).rejects.toMatchObject({
      code: 'LOG-GONE', // a missing file says so (see the LOG-GONE test)
    });
  });

  it('tail: the last N lines; tooLarge: over 50 MB (LOG-TOO-LARGE)', () => {
    const text = Array.from({ length: 6_000 }, (_, i) => `line ${i}`).join('\n');
    const t = tail(text, LOG_TAIL_LINES);
    expect(t.lines).toHaveLength(5_000);
    expect(t.lines[0]).toBe('line 1000');
    expect(t.cut).toBe(1_000);
    expect(tooLarge(50 * 1024 * 1024)).toBe(false);
    expect(tooLarge(50 * 1024 * 1024 + 1)).toBe(true);
  });

  it('filterLines: plain text (case-insensitive) or a regex; a bad regex is LOG-REGEX with the reason', () => {
    const lines = ['INFO start', 'WARN slow checkpoint', 'ERROR CheckpointException'];
    expect(filterLines(lines, 'checkpoint', false)).toEqual([
      'WARN slow checkpoint',
      'ERROR CheckpointException',
    ]);
    expect(filterLines(lines, '^(WARN|ERROR)', true)).toEqual([
      'WARN slow checkpoint',
      'ERROR CheckpointException',
    ]);
    expect(filterLines(lines, '', true)).toEqual(lines);
    expect(() => filterLines(lines, '(unclosed', true)).toThrow(
      expect.objectContaining({ code: 'LOG-REGEX' }),
    );
  });

  it('TaskManager logs: /taskmanagers/:id/logs (list) and /logs/:filename (file), ids and names encoded', async () => {
    const paths: string[] = [];
    const l = await listTmLogs(
      async (r) => (
        paths.push(r.path),
        reply(200, JSON.stringify({ logs: [{ name: 'taskmanager.log', size: 5, mtime: 1 }] }))()
      ),
      'prod',
      'tm 1',
    );
    expect(l).toEqual([{ name: 'taskmanager.log', size: 5, mtime: 1 }]);
    expect(
      await getTmLog(async (r) => (paths.push(r.path), reply(200, 'x')()), 'prod', 'tm 1', 'taskmanager.log'),
    ).toBe('x');
    expect(paths).toEqual(['/taskmanagers/tm%201/logs', '/taskmanagers/tm%201/logs/taskmanager.log']);
  });

  it('a log file that is gone is LOG-GONE on both: JobManager 404, TaskManager 500 "does not exist on the TaskExecutor"', async () => {
    await expect(
      getJmLog(
        reply(404, '{"errors":["This file does not exist in JobManager log dir."]}'),
        'prod',
        'jobmanager.log.3',
      ),
    ).rejects.toMatchObject({
      code: 'LOG-GONE',
      params: { file: 'jobmanager.log.3' },
    });
    const tm500 = JSON.stringify({
      errors: [
        'Internal server error.',
        '<Exception on server side: java.io.FileNotFoundException: The file taskmanager.log.3 does not exist on the TaskExecutor.',
      ],
    });
    await expect(getTmLog(reply(500, tm500), 'prod', 'tm1', 'taskmanager.log.3')).rejects.toMatchObject({
      code: 'LOG-GONE',
    });
    await expect(
      getTmLog(reply(500, '{"errors":["Internal server error."]}'), 'prod', 'tm1', 'x'),
    ).rejects.toMatchObject({ code: 'API-5XX' });
  });
});
