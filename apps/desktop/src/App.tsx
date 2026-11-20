import { AppError, ErrorBanner, ErrorDialog, present } from '@sl/errors';
import {
  jobBucket,
  listJobs,
  type Connection,
  type FlinkHttp,
  type FlinkJobRow,
  type KindChoice,
} from '@sl/flink';
import { Fleet, type CardState } from './Fleet';
import { useToast } from '@sl/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionForm } from './ConnectionForm';
import { Connections } from './Connections';
import { ImportDialog } from './ImportDialog';
import { Cluster } from './Cluster';
import { memoryHistory } from './history';
import { JobOverview } from './JobOverview';
import { Logs } from './Logs';
import { Palette, ShortcutsSheet, type Command } from './Palette';
import { Jobs } from './Jobs';
import { KindPicker } from './KindPicker';
import { gateFor } from './usePolled';
import { AllJobs } from './AllJobs';
import { Settings } from './Settings';
import { Welcome } from './Welcome';
import type { Saved } from './saved';
import type { View } from './SavedViews';

/**
 * The desktop app (M6). The same React code Tauri wraps (its devUrl); it reaches clusters only through the Rust
 * command flink_request (FLINK_API.md), which is not built yet. First run: Welcome (D01), "where does your cluster
 * run?" (C01, step 1 of 3), the connection form (D02, step 2); then the connection list (D03).
 * ponytail: screen state, not a router, until there is more than one flow; saved connections are held in memory
 * (and their secrets nowhere) until the Tauri storage (SQLite) and keychain land.
 */
type Screen =
  | { name: 'home' }
  | { name: 'list' }
  | { name: 'cluster'; id: string }
  | { name: 'jobs'; id: string }
  | { name: 'job'; id: string; jid: string; start?: { act: 'stop' | 'savepoint'; n: number } }
  | { name: 'logs'; id: string }
  | { name: 'kind'; kind: KindChoice | null }
  | { name: 'settings'; from: Screen }
  | { name: 'alljobs' }
  | { name: 'form'; kind: Connection['kind'] };

export function App({
  transport,
  test,
  keep,
  saved,
}: {
  transport?: (c: Connection) => FlinkHttp;
  /** Test connection before saving: the transport with the secret typed in the form (not yet in the keychain). */
  test?: (c: Connection, secret: string, more: { gateway: string; proxy: string }) => FlinkHttp;
  /** CONN-03: put a new connection's secrets in the OS keychain; rejects with CONN-KEYCHAIN. */
  keep?: (conn: string, secrets: { key: string; value: string }[]) => Promise<void>;
  /** The connections kept on this computer (the Tauri store); none: this session only. */
  saved?: Saved;
} = {}) {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [connections, setConnections] = useState<Connection[]>([]);
  // X18's saved views, for the app's life. ponytail: on disk with the connections once views are asked for there.
  const [views, setViews] = useState<View[]>([]);
  // Saved connections: read once; written on every change after a read that worked (never over a file that could
  // not be read). A failure is APP-STORE-FAILED, with Try again.
  const [storeError, setStoreError] = useState<AppError | null>(null);
  const [readOk, setReadOk] = useState(false);
  const [readTry, setReadTry] = useState(0);
  useEffect(() => {
    if (!saved) return;
    let live = true;
    saved.load().then(
      (cs) => {
        if (!live) return;
        // Added while it was read: kept too.
        setConnections((cur) => [...cs, ...cur.filter((c) => !cs.some((x) => x.id === c.id))]);
        setStoreError(null);
        setReadOk(true);
      },
      (e: unknown) =>
        live &&
        setStoreError(e instanceof AppError ? e : new AppError('APP-STORE-FAILED', { what: 'read' }, e)),
    );
    return () => {
      live = false;
    };
  }, [saved, readTry]);
  const [saveTry, setSaveTry] = useState(0);
  useEffect(() => {
    if (!saved || !readOk) return;
    saved.save(connections).then(
      () => setStoreError((e) => (e?.params.what === 'save' ? null : e)),
      (e: unknown) =>
        setStoreError(e instanceof AppError ? e : new AppError('APP-STORE-FAILED', { what: 'save' }, e)),
    );
  }, [saved, readOk, connections, saveTry]);
  const [importing, setImporting] = useState(false);
  // A save whose secrets the keychain refused: the form stays (nothing typed is lost) and the dialog says so.
  const [keepFailed, setKeepFailed] = useState<{ id: string; error: AppError; retry: () => void } | null>(
    null,
  );
  // One keychain write at a time. A second Try again of the same save is dropped (it would add the connection
  // twice). A newer Save of the same connection (edited meanwhile) waits and then wins, so what was typed last is
  // saved; a Save of another connection (Cancel, then a new form) waits and then runs too: both are kept.
  type Run = { id: string; run: () => unknown };
  const saving = useRef<Run | null>(null);
  const queued = useRef<Run | null>(null);
  const [fleetCache] = useState(() => new Map<string, CardState>());
  // JOB-06: one history store for the app's life (SQLite with the Rust side).
  const [history] = useState(memoryHistory);
  const toast = useToast();
  // ACT-01: stops sent and still running, by connection and job, so a page left and come back to follows them on
  // (never offers a second stop). ponytail: a result that comes while elsewhere is not toasted (app-level tracking).
  const [stops, setStops] = useState(() => new Map<string, { rid: string; at: number }>());
  const onStop = useCallback(
    (key: string) => (s: { rid: string; at: number } | null) =>
      setStops((m) => {
        const n = new Map(m);
        if (s) n.set(key, s);
        else n.delete(key);
        return n;
      }),
    [],
  );
  // Stops whose status was lost (may still run on the cluster), so the page says so after a remount too.
  const [lostStops, setLostStops] = useState(() => new Set<string>());
  const onStopLost = useCallback(
    (key: string) => (lost: boolean) =>
      setLostStops((m) => {
        if (m.has(key) === lost) return m;
        const n = new Set(m);
        if (lost) n.add(key);
        else n.delete(key);
        return n;
      }),
    [],
  );
  const forgetStops = (connId: string) => {
    const gone = (k: string) => k.startsWith(`${connId}/`);
    setStops((m) => new Map([...m].filter(([k]) => !gone(k))));
    setLostStops((m) => new Set([...m].filter((k) => !gone(k))));
  };
  // APP-04: what a new connection's refresh starts at (in memory until the Tauri store lands).
  const [defaultPollMs, setDefaultPollMs] = useState(5000);
  const add = () => setScreen({ name: 'kind', kind: null });
  // A palette pick lives in the job screen only until the page has taken it: nothing that restores or remounts
  // the screen can run it again (a second POST).
  const dropStart = useCallback(
    (n: number) =>
      setScreen((s) => (s.name === 'job' && s.start?.n === n ? { name: 'job', id: s.id, jid: s.jid } : s)),
    [],
  );
  // Settings remembers where it was opened from: Back returns there (from Settings itself, the same place). A job
  // screen is remembered without its palette pick (start): a second guard, as dropStart has usually removed it
  // already; a remount on Back must never run it again (a second POST).
  const openSettings = () =>
    setScreen((s) =>
      s.name === 'settings'
        ? s
        : { name: 'settings', from: s.name === 'job' ? { name: 'job', id: s.id, jid: s.jid } : s },
    );
  const home = () => setScreen({ name: 'home' });

  // APP-01 / board G01: ⌘K (Ctrl+K) anywhere but the connection steps (a jump would drop what is typed) and over
  // another dialog.
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const inSteps = screen.name === 'form' || screen.name === 'kind';
  // Board G02 keys. None over another dialog: a jump would get around its own lock (a Stop or Cancel that is
  // sending), drop what is typed in it (type-to-confirm, a folder), or leave it open in state for later (Import).
  // The plain keys (?, G J, G L) never while typing: there they are characters.
  // The open connection: on Settings, the one it was opened from (G J / G L go there).
  const cur =
    'id' in screen ? screen.id : screen.name === 'settings' && 'id' in screen.from ? screen.from.id : null;
  const gAt = useRef(0);
  useEffect(() => {
    if (inSteps) return;
    const overDialog = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');
    const typing = (e: KeyboardEvent) =>
      !!(e.target as HTMLElement | null)?.closest?.(
        // A checkbox, radio or button input takes no letters: the keys still work there.
        'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable=""], [contenteditable="true"]',
      );
    // A letter or digit by the character typed; by the physical key only when the character is not a Latin letter
    // or digit: AZERTY's ⌘ + "1/&" gives "&", an Arabic or Cyrillic layout gives its own letters. A Latin layout
    // (Dvorak, Colemak) goes by its labels. ("?" is by character: it moves.)
    const latin = (e: KeyboardEvent) => /^[a-z0-9]$/i.test(e.key);
    const is = (e: KeyboardEvent, ch: string) =>
      e.key.toLowerCase() === ch ||
      (!latin(e) && e.code === (/\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`));
    const digit = (e: KeyboardEvent) =>
      /^[1-9]$/.exec(e.key)?.[0] ?? (latin(e) ? undefined : /^Digit([1-9])$/.exec(e.code)?.[1]);
    const onKey = (e: KeyboardEvent) => {
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      const n = digit(e);
      if (mod && (e.key === ',' || e.code === 'Comma')) {
        if (overDialog()) return;
        e.preventDefault();
        openSettings();
      } else if (mod && is(e, 'k')) {
        if (overDialog()) return;
        e.preventDefault();
        setPalette(true);
      } else if (mod && n) {
        const c = transport ? connections[Number(n) - 1] : undefined;
        if (!c || overDialog()) return;
        e.preventDefault();
        setScreen({ name: 'cluster', id: c.id });
      } else if (plain && e.key === '?') {
        if (typing(e) || overDialog()) return;
        e.preventDefault();
        setSheet(true);
      } else if (plain && !e.shiftKey && (is(e, 'j') || is(e, 'l')) && Date.now() - gAt.current < 1_000) {
        gAt.current = 0;
        if (!transport || !cur || typing(e) || overDialog()) return;
        e.preventDefault();
        setScreen(is(e, 'j') ? { name: 'jobs', id: cur } : { name: 'logs', id: cur });
      } else if (plain && !e.shiftKey && is(e, 'g') && !typing(e)) {
        gAt.current = Date.now(); // G, then J or L within a second
      } else {
        gAt.current = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inSteps, transport, connections, cur]);
  // Board G01 "Jump to job": every connection's jobs, read when the palette opens (one GET each). A cluster that
  // can not be read is said in the palette; the rest still works.
  // Keyed by the connection object, not its id: Import → Replace keeps the id but not the cluster (a new object),
  // so it reads the new cluster. Weak: a removed or replaced connection's entry goes with it.
  const paletteReads = useRef(new WeakMap<Connection, Promise<FlinkJobRow[]>>());
  const [paletteJobs, setPaletteJobs] = useState<Record<string, { jobs?: FlinkJobRow[]; error?: AppError }>>(
    {},
  );
  useEffect(() => {
    if (!palette || !transport) return;
    let live = true;
    for (const c of connections) {
      // Through the connection's shared limiter (FLINK_API: at most 6 in flight), with its own timeout. At most one
      // palette read per connection: a reopen attaches to the one in flight, so closing and reopening never piles up
      // reads that hold the screens' slots.
      let read = paletteReads.current.get(c);
      if (!read) {
        read = gateFor(transport, c.id)
          .run(() => listJobs(transport(c), c.name, c.timeoutMs))
          .finally(() => paletteReads.current.delete(c));
        paletteReads.current.set(c, read);
      }
      read.then(
        (jobs) => live && setPaletteJobs((p) => ({ ...p, [c.id]: { jobs } })),
        (e: unknown) =>
          live &&
          setPaletteJobs((p) => ({
            ...p,
            [c.id]: { error: e instanceof AppError ? e : new AppError('API-SHAPE', {}, e) },
          })),
      );
    }
    return () => {
      live = false;
    };
  }, [palette, transport, connections]);
  const reading = transport ? connections.filter((c) => !paletteJobs[c.id]).length : 0;
  // Each note names its cluster: some catalog messages do not (API-SHAPE), and a transport error names the host.
  const paletteNotes = [
    ...(reading
      ? [{ key: 'reading', text: `Reading the jobs of ${reading} connection${reading === 1 ? '' : 's'}…` }]
      : []),
    ...connections.flatMap((c) => {
      const e = paletteJobs[c.id]?.error;
      return e ? [{ key: c.id, text: `${c.name}: ${present(e).message}` }] : [];
    }),
  ];
  // Same-name runs (a stop and resubmit) told apart by their state, in words; active ones first.
  const stateWord = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
  const jobsOf = (id: string) =>
    [...(paletteJobs[id]?.jobs ?? [])].sort(
      (a, b) => Number(jobBucket(a.state) === 'finished') - Number(jobBucket(b.state) === 'finished'),
    );
  const commands: Command[] = [
    ...(transport && connections.length ? [{ id: 'fleet', label: 'Fleet', run: home }] : []),
    { id: 'list', label: 'Connections', run: () => setScreen({ name: 'list' }) },
    ...(transport && connections.length
      ? [{ id: 'alljobs', label: 'Jobs · all connections', run: () => setScreen({ name: 'alljobs' }) }]
      : []),
    { id: 'add', label: 'Add connection', run: add },
    { id: 'keys', label: 'Keyboard shortcuts', hint: '?', run: () => setSheet(true) },
    { id: 'settings', label: 'Settings', hint: '⌘,', run: () => openSettings() },
    ...(transport
      ? connections.flatMap((c): Command[] => [
          {
            id: `c-${c.id}`,
            label: c.name,
            hint: `Cluster · ${c.env}`,
            run: () => setScreen({ name: 'cluster', id: c.id }),
          },
          { id: `j-${c.id}`, label: `Jobs · ${c.name}`, run: () => setScreen({ name: 'jobs', id: c.id }) },
          { id: `l-${c.id}`, label: `Logs · ${c.name}`, run: () => setScreen({ name: 'logs', id: c.id }) },
          ...jobsOf(c.id).map((j): Command => ({
            id: `job-${c.id}-${j.jid}`,
            label: j.name,
            hint: `Job · ${c.name} · ${stateWord(j.state)}`,
            run: () => setScreen({ name: 'job', id: c.id, jid: j.jid }),
          })),
          // Board G01 actions, for running jobs on a writable connection. They open the job page, which starts the
          // action once its own rules allow it (Stop: its confirm dialog first; Trigger: its one POST).
          ...(c.readOnly ? [] : jobsOf(c.id).filter((j) => j.state === 'RUNNING')).flatMap((j): Command[] => [
            {
              id: `sp-${c.id}-${j.jid}`,
              label: `Trigger savepoint: ${j.name}`,
              hint: `Action · ${c.name}`,
              run: () =>
                setScreen({ name: 'job', id: c.id, jid: j.jid, start: { act: 'savepoint', n: Date.now() } }),
            },
            {
              id: `stop-${c.id}-${j.jid}`,
              label: `Stop with savepoint: ${j.name}`,
              hint: `Action · ${c.name}`,
              run: () =>
                setScreen({ name: 'job', id: c.id, jid: j.jid, start: { act: 'stop', n: Date.now() } }),
            },
          ]),
        ])
      : []),
  ];
  const view = (() => {
    if (screen.name === 'form')
      return (
        <ConnectionForm
          kind={screen.kind}
          pollMs={defaultPollMs}
          taken={connections.map((c) => c.name)}
          {...(test ? { test } : {})}
          onCancel={() => setScreen({ name: 'kind', kind: screen.kind })}
          onSave={({ connection, secrets }) => {
            const done = () => {
              setConnections((cs) => [...cs, connection]);
              toast({ severity: 'success', message: `Saved ${connection.name}.` });
              setScreen({ name: 'home' });
            };
            if (!keep) return done();
            const id = connection.id;
            const attempt = (): unknown => {
              if (saving.current?.run === attempt) return;
              if (saving.current) return void (queued.current = { id, run: attempt });
              saving.current = { id, run: attempt };
              // The save waiting behind this one; `newer`: the same connection, so this one's outcome is skipped.
              const next = () => {
                saving.current = null;
                const q = queued.current;
                queued.current = null;
                return { q, newer: q?.id === id };
              };
              // A save with no secrets still waits its turn (else it could land between and add twice).
              return (secrets.length ? keep(connection.name, secrets) : Promise.resolve()).then(
                () => {
                  const { q, newer } = next();
                  if (!newer) {
                    setKeepFailed((k) => (k?.id === id ? null : k));
                    done();
                  }
                  return q?.run();
                },
                (e: unknown) => {
                  const { q, newer } = next();
                  if (!newer)
                    setKeepFailed({
                      id,
                      error:
                        e instanceof AppError
                          ? e
                          : new AppError('CONN-KEYCHAIN', { conn: connection.name }, e),
                      retry: attempt,
                    });
                  return q?.run();
                },
              );
            };
            void attempt();
          }}
        />
      );
    if (transport && screen.name === 'alljobs')
      return (
        <AllJobs
          connections={connections}
          transport={transport}
          onOpenJob={(id, jid) => setScreen({ name: 'job', id, jid })}
          onFleet={home}
          views={views}
          onViews={setViews}
        />
      );
    if (screen.name === 'settings')
      return (
        <Settings pollMs={defaultPollMs} onPollMs={setDefaultPollMs} onBack={() => setScreen(screen.from)} />
      );
    if (screen.name === 'kind')
      return (
        <KindPicker
          value={screen.kind}
          onChange={(kind) => setScreen({ name: 'kind', kind })}
          onBack={() => setScreen({ name: 'home' })}
          onContinue={() =>
            screen.kind && screen.kind !== 'confluent' && setScreen({ name: 'form', kind: screen.kind })
          }
        />
      );
    // Home: Welcome (D01) with no connections yet, else the connection list (D03).
    const open =
      screen.name === 'jobs' || screen.name === 'cluster' || screen.name === 'job' || screen.name === 'logs'
        ? connections.find((c) => c.id === screen.id)
        : undefined;
    if (transport && open && screen.name === 'cluster')
      return (
        <Cluster
          key={open.id}
          c={open}
          transport={transport}
          onFleet={home}
          onJobs={() => setScreen({ name: 'jobs', id: open.id })}
          onLogs={() => setScreen({ name: 'logs', id: open.id })}
        />
      );
    if (transport && open && screen.name === 'logs')
      return (
        <Logs
          key={open.id}
          c={open}
          transport={transport}
          onCluster={() => setScreen({ name: 'cluster', id: open.id })}
        />
      );
    if (transport && open && screen.name === 'job')
      return (
        <JobOverview
          key={`${open.id}/${screen.jid}`}
          c={open}
          jid={screen.jid}
          {...(screen.start ? { start: screen.start } : {})}
          stop={stops.get(`${open.id}/${screen.jid}`) ?? null}
          onStop={onStop(`${open.id}/${screen.jid}`)}
          stopLost={lostStops.has(`${open.id}/${screen.jid}`)}
          onStopLost={onStopLost(`${open.id}/${screen.jid}`)}
          onStartTaken={dropStart}
          transport={transport}
          history={history}
          onJobs={() => setScreen({ name: 'jobs', id: open.id })}
        />
      );
    if (transport && open)
      return (
        <Jobs
          key={open.id}
          c={open}
          transport={transport}
          onFleet={home}
          onCluster={() => setScreen({ name: 'cluster', id: open.id })}
          onOpenJob={(jid) => setScreen({ name: 'job', id: open.id, jid })}
        />
      );
    const importDialog = (
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        existing={connections}
        onImport={({ add: added, replace }) => {
          setConnections((cs) => [...cs.map((c) => replace.find((r) => r.id === c.id) ?? c), ...added]);
          // A replaced connection keeps its id, not its cluster: the fleet forgets what the old one said.
          for (const r of replace) {
            fleetCache.delete(r.id);
            forgetStops(r.id); // same id, another cluster: never resume the old one's stop
          }
          const n = added.length + replace.length;
          toast({ severity: 'success', message: `Imported ${n} connection${n === 1 ? '' : 's'}.` });
        }}
      />
    );
    // With a way to reach clusters, home is the fleet (D04); the list is one click away.
    if (transport && connections.length && screen.name === 'home')
      return (
        <>
          <Fleet
            connections={connections}
            transport={transport}
            onAdd={add}
            onManage={() => setScreen({ name: 'list' })}
            cache={fleetCache}
            onOpen={(c) => setScreen({ name: 'cluster', id: c.id })}
          />
          {importDialog}
        </>
      );
    if (!connections.length)
      return (
        <>
          <Welcome onAdd={add} onImport={() => setImporting(true)} />
          {importDialog}
        </>
      );
    return (
      <>
        <Connections
          connections={connections}
          kept={!!saved}
          onAdd={add}
          {...(transport ? { onFleet: () => setScreen({ name: 'home' }) } : {})}
          onImport={() => setImporting(true)}
          onRemove={(id) => {
            fleetCache.delete(id);
            forgetStops(id);
            setConnections((cs) => cs.filter((c) => c.id !== id));
          }}
        />
        {importDialog}
      </>
    );
  })();
  return (
    <>
      {storeError && (
        <div className="bg-surface px-8 pt-5">
          <ErrorBanner
            error={storeError}
            handles={new Set(['Try again'])}
            onAction={() =>
              storeError.params.what === 'read' ? setReadTry((n) => n + 1) : setSaveTry((n) => n + 1)
            }
          />
        </div>
      )}
      {view}
      {palette && !inSteps && (
        <Palette
          commands={commands}
          notes={paletteNotes}
          onClose={() => {
            setPalette(false);
            setPaletteJobs({}); // read again next time
          }}
        />
      )}
      {sheet && !inSteps && <ShortcutsSheet onClose={() => setSheet(false)} />}
      {keepFailed && (
        <ErrorDialog
          error={keepFailed.error}
          open
          onOpenChange={(o) => !o && setKeepFailed(null)}
          // Try again: the same secrets once more. Enter secret: back to the form, as typed.
          onAction={(l) => (l === 'Try again' ? keepFailed.retry() : setKeepFailed(null))}
        />
      )}
    </>
  );
}
