import { describe, expect, it } from 'vitest';
import { simulatorSupported } from './support';

describe('BROWSER-UNSUPPORTED · feature detection', () => {
  const ok = { Worker: function () {} as never, WebAssembly: {} as never, indexedDB: {} as never };
  it('needs Worker, WebAssembly and IndexedDB, each of them', () => {
    expect(simulatorSupported(ok)).toBe(true);
    expect(simulatorSupported({ ...ok, Worker: undefined })).toBe(false);
    expect(simulatorSupported({ ...ok, WebAssembly: undefined })).toBe(false);
    expect(simulatorSupported({ ...ok, indexedDB: undefined })).toBe(false);
  });
});
