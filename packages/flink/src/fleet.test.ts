import { describe, expect, it } from 'vitest';
import { fleetStatus } from './fleet';
import { TransportError, type FlinkHttp } from './http';

const ok = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), url: 'https://f' });
const answers: Record<string, unknown> = {
  '/config': { 'flink-version': '2.3.0' },
  '/overview': {
    taskmanagers: 4,
    'slots-total': 32,
    'slots-available': 6,
    'jobs-running': 13,
    'jobs-finished': 2,
    'jobs-cancelled': 0,
    'jobs-failed': 7,
  },
  '/jobs/overview': {
    jobs: [
      { jid: 'a', name: 'fraud-scoring', state: 'RESTARTING' },
      { jid: 'b', name: 'old', state: 'FAILED' },
      { jid: 'c', name: 'x', state: 'RUNNING' },
    ],
  },
};
const fake =
  (over: Partial<Record<string, ReturnType<typeof ok> | Error>> = {}): FlinkHttp =>
  async (req) => {
    const o = over[req.path];
    if (o instanceof Error) throw o;
    return o ?? ok(answers[req.path]);
  };

describe('FLEET-01 fleetStatus', () => {
  it('a healthy cluster: version, jobs not done (running includes restarting, as Flink counts), failing now (not FAILED history), slots', async () => {
    expect(await fleetStatus(fake(), 'payments-prod')).toEqual({
      state: 'up',
      version: '2.3.0',
      jobs: 2,
      running: 1,
      failing: 1,
      slotsFree: 6,
      slotsTotal: 32,
      taskmanagers: 4,
    });
  });
  it('refused is CONN-REFUSED; 401 is API-401; 500 is API-5XX; a reply it can not read is API-SHAPE', async () => {
    const down = async (h: FlinkHttp) => {
      const r = await fleetStatus(h, 'payments-prod');
      if (r.state !== 'down') throw new Error('up');
      return r.error.code;
    };
    expect(
      await down(fake({ '/config': new TransportError({ kind: 'refused', host: 'h', port: 8081 }) })),
    ).toBe('CONN-REFUSED');
    expect(await down(fake({ '/overview': { status: 401, headers: {}, body: '', url: '' } }))).toBe(
      'API-401',
    );
    expect(await down(fake({ '/jobs/overview': { status: 503, headers: {}, body: '', url: '' } }))).toBe(
      'API-5XX',
    );
    expect(await down(fake({ '/overview': ok({ nope: 1 }) }))).toBe('API-SHAPE');
    expect(await down(fake({ '/config': { status: 200, headers: {}, body: '<html>', url: '' } }))).toBe(
      'API-SHAPE',
    );
  });
});
