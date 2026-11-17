/**
 * JOB-06 / board D10: local history, recorded on this computer while Stream Lab is open. Behind HistoryStore so
 * SQLite (tauri-plugin-sql, ruling 2026-11-17) can replace the in-memory store when the Rust side lands. Keyed by
 * connection and job: a job id repeats across clusters.
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
  append(conn: string, jid: string, events: readonly HistoryEvent[]): Promise<void>;
  /** Newest first. */
  events(conn: string, jid: string): Promise<HistoryEvent[]>;
  /** Record a time span the app was open; the same `from` again extends it (the later `to` wins). */
  session(from: number, to: number): Promise<void>;
  sessions(): Promise<Session[]>;
}

export function memoryHistory(): HistoryStore {
  const byJob = new Map<string, HistoryEvent[]>();
  const open = new Map<number, number>();
  const key = (conn: string, jid: string) => `${conn}\u0000${jid}`;
  return {
    async append(conn, jid, events) {
      const k = key(conn, jid);
      byJob.set(k, [...(byJob.get(k) ?? []), ...events]);
    },
    async events(conn, jid) {
      return [...(byJob.get(key(conn, jid)) ?? [])].sort((a, b) => b.at - a.at);
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
  /** Flink's JobDetailsInfo `timestamps`: when the job last entered each state (0: never). */
  timestamps?: Record<string, number> | undefined;
  vertices: readonly { id: string; name: string; parallelism: number }[];
}

/**
 * Events between two reads of one job.
 * - A restart: the time Flink says the job last entered RESTARTING moved (default scheduler: caught even when
 *   no read landed in RESTARTING), at that time. Several restarts between two reads are one event.
 *   ponytail: under the adaptive scheduler that time never moves, so a restart is caught only when a read lands
 *   in RESTARTING; a short one between two reads is missed. Candidate rule (RUNNING moved while RESTARTING did
 *   not) is unverified against Flink: see MORNING.md.
 * - An operator's parallelism changed: a rescale. A restart that changed parallelism is one rescale (the adaptive
 *   scheduler rescales through a restart), not a restart as well.
 * The first read is a baseline. Only what the reads show: no cause is guessed.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/job/JobDetailsInfo.java
 */
export function diffJob(prev: JobShape | null, next: JobShape, at: number): HistoryEvent[] {
  if (!prev) return [];
  const was = new Map(prev.vertices.map((v) => [v.id, v.parallelism]));
  const rescales: HistoryEvent[] = [];
  for (const v of next.vertices) {
    const p = was.get(v.id);
    if (p !== undefined && p !== v.parallelism)
      rescales.push({ at, kind: 'rescale', detail: `${v.name}: parallelism ${p} → ${v.parallelism}` });
  }
  if (rescales.length) return rescales;
  const r0 = prev.timestamps?.RESTARTING ?? 0;
  const r1 = next.timestamps?.RESTARTING ?? 0;
  if (r1 > r0) return [{ at: r1, kind: 'restart', detail: 'Job restarted' }];
  // The adaptive scheduler's Restarting only reports RESTARTING (it cancels the graph; the timestamp stays 0), and
  // an old Flink may send no timestamps: entering RESTARTING between two reads is then the sign.
  // FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/scheduler/adaptive/Restarting.java
  if (next.state === 'RESTARTING' && prev.state !== 'RESTARTING')
    return [{ at, kind: 'restart', detail: 'Job restarted' }];
  return [];
}

/** D10 "Grey bands are times it was closed": the spans no session covers, newest first. */
export function gaps(sessions: readonly Session[]): Session[] {
  const s = [...sessions].sort((a, b) => a.from - b.from);
  const out: Session[] = [];
  let end = s[0]?.to ?? 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i]!.from > end) out.push({ from: end, to: s[i]!.from });
    end = Math.max(end, s[i]!.to);
  }
  return out.reverse();
}
