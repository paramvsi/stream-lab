/**
 * JOB-06 / board D10: local history, recorded on this computer while Stream Lab is open. Behind HistoryStore so
 * SQLite (tauri-plugin-sql, ruling 2026-11-17) can replace the in-memory store when the Rust side lands.
 * ponytail: in memory, no retention or size limit yet (Settings, HISTORY-FULL); metrics samples for the chart
 * (records in, watermark lag) are a next slice.
 */

export interface HistoryEvent {
  at: number;
  kind: 'restart' | 'rescale';
  detail: string;
}

export interface Session {
  from: number;
  to: number;
}

export interface HistoryStore {
  append(jid: string, events: readonly HistoryEvent[]): Promise<void>;
  /** Newest first. */
  events(jid: string): Promise<HistoryEvent[]>;
  /** Record (or extend) a time span the app was open. */
  session(from: number, to: number): Promise<void>;
  sessions(): Promise<Session[]>;
}

export function memoryHistory(): HistoryStore {
  const byJob = new Map<string, HistoryEvent[]>();
  const open = new Map<number, number>();
  return {
    async append(jid, events) {
      byJob.set(jid, [...(byJob.get(jid) ?? []), ...events]);
    },
    async events(jid) {
      return [...(byJob.get(jid) ?? [])].sort((a, b) => b.at - a.at);
    },
    async session(from, to) {
      open.set(from, Math.max(to, open.get(from) ?? to));
    },
    async sessions() {
      return [...open].map(([from, to]) => ({ from, to })).sort((a, b) => a.from - b.from);
    },
  };
}

interface JobShape {
  state: string;
  vertices: readonly { id: string; name: string; parallelism: number }[];
}

/**
 * Events between two reads of one job: entering RESTARTING (once, not each read while it lasts) and an operator's
 * parallelism changing. The first read is a baseline. Only what the reads show: no cause is guessed (Flink's job
 * read does not say why a job rescaled).
 */
export function diffJob(prev: JobShape | null, next: JobShape, at: number): HistoryEvent[] {
  if (!prev) return [];
  const out: HistoryEvent[] = [];
  if (next.state === 'RESTARTING' && prev.state !== 'RESTARTING')
    out.push({ at, kind: 'restart', detail: 'Job restarted' });
  const was = new Map(prev.vertices.map((v) => [v.id, v.parallelism]));
  for (const v of next.vertices) {
    const p = was.get(v.id);
    if (p !== undefined && p !== v.parallelism)
      out.push({ at, kind: 'rescale', detail: `${v.name}: parallelism ${p} → ${v.parallelism}` });
  }
  return out;
}

/** D10 "Grey bands are times it was closed": the spans between sessions, newest first. */
export function gaps(sessions: readonly Session[]): Session[] {
  const s = [...sessions].sort((a, b) => a.from - b.from);
  const out: Session[] = [];
  for (let i = 1; i < s.length; i++)
    if (s[i]!.from > s[i - 1]!.to) out.push({ from: s[i - 1]!.to, to: s[i]!.from });
  return out.reverse();
}
