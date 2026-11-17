/// <reference lib="webworker" />
// The D18 regex filter, off the UI thread (logFilter.ts kills it past its time limit).
self.onmessage = (e: MessageEvent<{ lines: string[]; pattern: string }>) => {
  try {
    const re = new RegExp(e.data.pattern);
    self.postMessage({ ok: true, lines: e.data.lines.filter((l) => re.test(l)) });
  } catch (err) {
    self.postMessage({ ok: false, reason: err instanceof Error ? err.message : String(err) });
  }
};
