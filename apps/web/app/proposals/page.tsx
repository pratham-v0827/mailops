'use client';

import { describeProposal, type ProposalPayload } from '@mailops/schema';
import { useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useMailboxes } from '../../components/MailboxProvider';
import {
  Badge,
  Button,
  Empty,
  errorText,
  Notice,
  PageHeader,
  Table,
  useMailboxResource,
  when,
  WithMailbox,
} from '../../components/ui';
import type { ProposalsResponse, ProposalView } from '../../lib/api-types';

export default function ProposalsPage() {
  return (
    <AppShell>
      <WithMailbox>{() => <Proposals />}</WithMailbox>
    </AppShell>
  );
}

function Proposals() {
  const pending = useMailboxResource<ProposalsResponse>('/proposals');
  const decided = useMailboxResource<ProposalsResponse>('/proposals?status=decided');
  const { reload: reloadMailboxes } = useMailboxes();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function decide(p: ProposalView, decision: 'approve' | 'reject') {
    setBusy(p.id);
    setError('');
    try {
      await pending.api(`${pending.base}/proposals/${p.id}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await Promise.all([pending.reload(), decided.reload(), reloadMailboxes()]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const list = pending.data?.proposals ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        subtitle="Changes suggested by Claude (MCP) or others wait here until you approve them"
      />
      {error && <Notice tone="bad">{error}</Notice>}
      {pending.error && <Notice tone="bad">{pending.error.message}</Notice>}
      {!pending.data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : list.length === 0 ? (
        <Empty>Nothing waiting for approval.</Empty>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-amber-300 bg-white p-4 dark:border-amber-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{describeProposal(p.payload as ProposalPayload)}</p>
                  <p className="text-xs text-slate-500">
                    from {p.source} · {when(p.createdAt)}
                    {p.reason && <> · “{p.reason}”</>}
                  </p>
                  <Details payload={p.payload as ProposalPayload} />
                </div>
                <div className="flex gap-2">
                  <Button disabled={busy === p.id} onClick={() => decide(p, 'approve')}>
                    Approve
                  </Button>
                  <Button
                    kind="secondary"
                    disabled={busy === p.id}
                    onClick={() => decide(p, 'reject')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="pt-4 text-sm font-medium uppercase tracking-wide text-slate-500">History</h2>
      {(decided.data?.proposals ?? []).length === 0 ? (
        <Empty>No decided proposals yet.</Empty>
      ) : (
        <Table head={['Change', 'From', 'Status', 'Decided by', 'Result']}>
          {decided.data!.proposals.map((p) => (
            <tr key={p.id}>
              <td>{describeProposal(p.payload as ProposalPayload)}</td>
              <td>{p.source}</td>
              <td>
                <Badge
                  tone={
                    p.status === 'applied'
                      ? 'good'
                      : p.status === 'failed'
                        ? 'bad'
                        : p.status === 'rejected'
                          ? 'default'
                          : 'info'
                  }
                >
                  {p.status === 'approved' ? 'approved · waiting for engine' : p.status}
                </Badge>
              </td>
              <td className="text-xs text-slate-500">{p.decidedBy ?? '—'}</td>
              <td className="text-xs text-slate-500">{p.result?.message ?? ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Details({ payload }: { payload: ProposalPayload }) {
  if (payload.kind === 'rule.upsert') {
    const r = payload.rule;
    return (
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Archive: {r.archiveAfterDays ?? 'never'} · Trash:{' '}
        {r.neverDelete ? 'never (Never Delete)' : (r.trashAfterDays ?? 'never')} ·{' '}
        {r.enabled ? 'enabled' : 'disabled'}
      </p>
    );
  }
  if (payload.kind === 'filter.create') {
    return (
      <p className="mt-2 font-mono text-xs text-slate-600 dark:text-slate-300">
        {Object.entries(payload.criteria)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(' · ')}{' '}
        → {payload.addLabel}
        {payload.archive ? ' (skip inbox)' : ''}
      </p>
    );
  }
  return null;
}
