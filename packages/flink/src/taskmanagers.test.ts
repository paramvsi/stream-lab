import { describe, expect, it } from 'vitest';
import type { FlinkHttp } from './http';
import { listTaskManagers, tmAddress } from './taskmanagers';

const tm = (id: string, path: string, slots: number, free: number, blocked = false) => ({
  id,
  path,
  dataPort: 41_000,
  timeSinceLastHeartbeat: 1_700_000_000_000,
  slotsNumber: slots,
  freeSlots: free,
  blocked,
});

describe('FLEET-02 · TaskManagers (board D05b)', () => {
  it('reads GET /taskmanagers', async () => {
    const http: FlinkHttp = async (req) => {
      expect(req).toMatchObject({ method: 'GET', path: '/taskmanagers' });
      return {
        status: 200,
        headers: {},
        url: '',
        body: JSON.stringify({
          taskmanagers: [
            tm('10.0.4.21:6122-a1b2c3', 'pekko.tcp://flink@10.0.4.21:6122/user/rpc/taskmanager_0', 4, 0),
          ],
        }),
      };
    };
    const [t] = await listTaskManagers(http, 'payments-prod');
    expect(t).toMatchObject({ slotsNumber: 4, freeSlots: 0 });
  });

  it('the address is the host (board D05b) from the RPC path (akka or pekko), else the id', () => {
    expect(tmAddress(tm('x', 'akka.tcp://flink@10.0.4.21:6122/user/rpc/taskmanager_0', 4, 0))).toBe(
      '10.0.4.21',
    );
    expect(tmAddress(tm('x', 'pekko://flink@tm-7.svc:6122/user/rpc/taskmanager_0', 4, 0))).toBe('tm-7.svc');
    expect(tmAddress(tm('10.0.4.9:1-z', 'odd', 4, 0))).toBe('10.0.4.9:1-z');
    // IPv6: the bracketed host (audit of ae8f98a)
    expect(tmAddress(tm('x', 'pekko.tcp://flink@[fd00::5]:6122/user/rpc/taskmanager_0', 4, 0))).toBe(
      '[fd00::5]',
    );
  });

  it('API-SHAPE when the list can not be read', async () => {
    const http: FlinkHttp = async () => ({
      status: 200,
      headers: {},
      url: '',
      body: '{"taskmanagers":[{"id":1}]}',
    });
    await expect(listTaskManagers(http, 'p')).rejects.toMatchObject({ code: 'API-SHAPE' });
  });
});
