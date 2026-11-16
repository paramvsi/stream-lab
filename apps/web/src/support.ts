/**
 * BROWSER-UNSUPPORTED (board WX07): what the simulator needs from the browser — the engine runs in a Web Worker,
 * the SQL node uses WebAssembly, pipelines are kept in IndexedDB. Checked on the simulator's pages and the
 * chapter sandbox; the reading never needs them.
 */
export function simulatorSupported(
  w: Partial<Pick<typeof globalThis, 'Worker' | 'WebAssembly' | 'indexedDB'>> = globalThis,
) {
  return typeof w.Worker === 'function' && typeof w.WebAssembly === 'object' && !!w.indexedDB;
}
