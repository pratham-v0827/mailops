'use client';

import Link from 'next/link';
import { AppShell } from '../../components/AppShell';
import {
  Badge,
  Empty,
  Notice,
  PageHeader,
  Table,
  useMailboxResource,
  WithMailbox,
} from '../../components/ui';
import type { RunsResponse } from '../../lib/api-types';

export default function RunsPage() {
  return (
    <AppShell>
      <WithMailbox>{() => <Runs />}</WithMailbox>
    </AppShell>
  );
}

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'default' | 'info'> = {
  SUCCESS: 'good',
  'PARTIAL SUCCESS': 'warn',
  CONTINUING: 'info',
  PAUSED: 'warn',
  FAILED: 'bad',
  SKIPPED: 'default',
};

function Runs() {
  const { data, error } = useMailboxResource<RunsResponse>('/runs?limit=100');
  if (error) return <Notice tone="bad">{error.message}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Runs"
        subtitle="Each batch the engine ran. A pass (one session) is several batches of up to ~4 minutes."
      />
      {data.runs.length === 0 ? (
        <Empty>No runs reported yet.</Empty>
      ) : (
        <Table
          head={[
            'Finished',
            'Mode',
            'Status',
            'Scanned',
            'Archived',
            'To Trash',
            'Protected',
            'Skipped',
            'Errors',
            'Trigger',
            '',
          ]}
        >
          {data.runs.map((r) => (
            <tr key={r.runId}>
              <td className="whitespace-nowrap text-xs">{new Date(r.endedAt).toLocaleString()}</td>
              <td>{r.mode === 'dry' ? 'Dry run' : 'Production'}</td>
              <td>
                <Badge tone={TONE[r.status] ?? 'default'}>{r.status}</Badge>
              </td>
              <td className="text-right">{r.scanned}</td>
              <td className="text-right">{r.archived}</td>
              <td className="text-right">{r.trashed}</td>
              <td className="text-right">{r.protected}</td>
              <td className="text-right">{r.skipped}</td>
              <td className="text-right">{r.errors}</td>
              <td className="max-w-[16rem] truncate text-xs text-slate-500" title={r.notes}>
                {r.triggerType}
                {r.notes ? ` · ${r.notes}` : ''}
              </td>
              <td>
                <Link
                  href={`/activity?run=${encodeURIComponent(r.runId)}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
