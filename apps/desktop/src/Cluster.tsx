import {
  fleetStatus,
  listTaskManagers,
  tmAddress,
  type Connection,
  type FlinkHttp,
  type FlinkTaskManager,
  type FleetStatus,
} from '@sl/flink';
import { Button, EmptyState, Loading, Skeleton, StatusBadge, Table, type Column } from '@sl/ui';
import { LayoutGrid, ListChecks, Server } from 'lucide-react';
import { useEffect } from 'react';
import { ENV } from './Connections';
import { useScreenHeading } from './focus';
import { Kpi } from './Kpi';
import { usePolled } from './usePolled';

type Up = Extract<FleetStatus, { state: 'up' }>;

/** One read of the cluster page: the fleet's summary (three calls) and the TaskManagers. */
async function readCluster(http: FlinkHttp, conn: string, timeoutMs: number) {
  const [s, tms] = await Promise.all([
    fleetStatus(http, conn, timeoutMs),
    listTaskManagers(http, conn, timeoutMs),
  ]);
  if (s.state === 'down') throw s.error;
  return { s, tms };
}

const columns: Column<FlinkTaskManager>[] = [
  { key: 'id', header: 'TaskManager', mono: true, render: (t) => t.id },
  { key: 'addr', header: 'Address', mono: true, render: (t) => tmAddress(t) },
  {
    key: 'slots',
    header: 'Slots',
    mono: true,
    render: (t) => `${t.slotsNumber - t.freeSlots}/${t.slotsNumber}`,
  },
  {
    key: 'status',
    header: 'Status',
    render: (t) =>
      t.blocked ? (
        <StatusBadge tone="warning">Blocked</StatusBadge>
      ) : (
        <StatusBadge tone="success">OK</StatusBadge>
      ),
  },
];

/**
 * FLEET-02 / boards D05 (cluster overview KPIs) and D05b (TaskManagers): one connection, polled every 5 s with
 * the §4 error handling of usePolled. Opened from a fleet card; Jobs goes to the list (D07).
 * ponytail: JVM heap (JM), per-TaskManager Heap and Version, the slots chart, recent events, the JobManager and
 * Configuration tabs and the TaskManager detail (D05c) need metrics, history (JOB-06) and those calls: next slices.
 * Until the Overview tab has its chart, the page is one view (KPIs + TaskManagers), not D05's four tabs. The
 * subtitle's "session cluster · up 18 days" and the KPI note "all registered" wait for the JobManager calls.
 * D05b's "ok / busy" status needs heap metrics; until then the words are Flink's own blocklist flag (OK / Blocked).
 */
export function Cluster({
  c,
  transport,
  onFleet,
  onJobs,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  onFleet?: () => void;
  onJobs?: () => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = `${c.name} · Stream Lab`;
  }, [c.name]);
  const { value, stale, since, banner } = usePolled(c, transport, readCluster, h1);
  const s: Up | undefined = value?.s;
  const used = s ? s.slotsTotal - s.slotsFree : 0;
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {banner}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            {c.name}
          </h1>
          <p className="m-0 text-[14px] text-muted">
            {ENV[c.env]}
            {s ? ` · Flink ${s.version}` : ''}
          </p>
        </div>
        <div className="flex gap-3">
          {onFleet && (
            <Button icon={<LayoutGrid size={16} aria-hidden="true" />} onClick={onFleet}>
              Fleet
            </Button>
          )}
          {onJobs && (
            <Button icon={<ListChecks size={16} aria-hidden="true" />} onClick={onJobs}>
              Jobs
            </Button>
          )}
        </div>
      </div>
      {!value ? (
        !banner && (
          <Loading label={`Loading ${c.name}`}>
            <Skeleton height={96} />
            <Skeleton height={240} />
          </Loading>
        )
      ) : (
        <>
          {stale && <p className="m-0 text-[13px] text-muted">Not answering. Showing data from {since}.</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            <Kpi label="Task slots" value={`${used} / ${s!.slotsTotal} used`} note={`${s!.slotsFree} free`} />
            <Kpi label="TaskManagers" value={s!.taskmanagers} />
            <Kpi
              label="Running jobs"
              // Not done and not failing, as on the fleet card (D05: "13 · 1 failing" of 14 jobs).
              value={s!.running}
              {...(s!.failing ? { note: `${s!.failing} failing`, tone: 'error' as const } : {})}
            />
          </div>
          <h2 className="m-0 text-[18px] font-semibold">TaskManagers</h2>
          {value.tms.length ? (
            <Table label="TaskManagers" columns={columns} rows={value.tms} rowKey={(t) => t.id} />
          ) : (
            <EmptyState icon={Server} title="No TaskManagers registered" level={3}>
              Jobs can not run until a TaskManager joins. Check that the TaskManagers are up and can reach the
              JobManager.
            </EmptyState>
          )}
        </>
      )}
    </main>
  );
}
