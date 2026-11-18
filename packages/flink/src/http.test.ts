import { present } from '@sl/errors';
import { describe, expect, it } from 'vitest';
import { fromTransport } from './http';

describe('CONN-PROXY', () => {
  it('a refusal with no status says so, never "()"', () => {
    const e = fromTransport({ kind: 'proxy', host: 'h', proxy: 'http://px:3128' });
    expect(present(e).message).toBe('The proxy http://px:3128 refused the connection (no status given).');
  });
  it('a 407 names it', () => {
    const e = fromTransport({ kind: 'proxy', host: 'h', proxy: 'http://px:3128', status: 407 });
    expect(present(e).message).toBe('The proxy http://px:3128 refused the connection (407).');
  });
});
