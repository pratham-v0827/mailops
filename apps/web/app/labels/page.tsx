'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import {
  Badge,
  Button,
  Empty,
  errorText,
  inputCls,
  Notice,
  PageHeader,
  Table,
  useCommand,
  useMailboxResource,
  when,
  WithMailbox,
} from '../../components/ui';
import type { LabelsResponse, RulesResponse } from '../../lib/api-types';

export default function LabelsPage() {
  return (
    <AppShell>
      <WithMailbox>{() => <Labels />}</WithMailbox>
    </AppShell>
  );
}

function Labels() {
  const { data, error } = useMailboxResource<LabelsResponse>('/labels');
  const rules = useMailboxResource<RulesResponse>('/rules');
  const command = useCommand();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const byLabel = useMemo(
    () => new Map((rules.data?.rules ?? []).map((r) => [r.label, r])),
    [rules.data],
  );
  const labels = (data?.labels ?? [])
    .filter((l) => l.type === 'user')
    .filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function create() {
    try {
      await command({ kind: 'label.create', label: name.trim() });
      setNote({
        tone: 'good',
        text: `Queued: the engine creates “${name.trim()}” on its next sync (within 15 minutes).`,
      });
      setName('');
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    }
  }

  async function refresh() {
    try {
      await command({ kind: 'mirror.refresh' });
      setNote({ tone: 'good', text: 'Queued: labels and filters are re-sent on the next sync.' });
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    }
  }

  if (error) return <Notice tone="bad">{error.message}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labels"
        subtitle={`Your Gmail labels as the engine last reported them · ${when(data.updatedAt)}`}
      >
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className={`${inputCls} w-48`}
        />
        <Button kind="secondary" onClick={refresh}>
          Refresh
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New label, e.g. Receipts/Shops"
          className={`${inputCls} max-w-sm`}
        />
        <Button onClick={create} disabled={!name.trim()}>
          Create label
        </Button>
        <span className="text-xs text-slate-500">
          Parents are created too. Labels are never renamed or deleted by MailOps.
        </span>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {labels.length === 0 ? (
        <Empty>
          {data.updatedAt
            ? 'No labels match.'
            : 'The engine hasn’t sent your labels yet; they arrive with its first sync.'}
        </Empty>
      ) : (
        <Table head={['Label', 'Messages', 'Unread', 'Lifecycle rule']}>
          {labels.map((l) => {
            const r = byLabel.get(l.name);
            return (
              <tr key={l.id}>
                <td className="font-medium">{l.name}</td>
                <td className="text-right">{l.messagesTotal ?? '—'}</td>
                <td className="text-right">{l.messagesUnread ?? '—'}</td>
                <td className="text-sm">
                  {r ? (
                    <span className={r.enabled ? '' : 'opacity-50'}>
                      {r.archiveAfterDays !== null
                        ? `archive ${r.archiveAfterDays} d`
                        : 'no archive'}{' '}
                      ·{' '}
                      {r.neverDelete ? (
                        <Badge tone="good">never delete</Badge>
                      ) : r.trashAfterDays !== null ? (
                        `trash ${r.trashAfterDays} d`
                      ) : (
                        'no trash'
                      )}
                    </span>
                  ) : (
                    <Link href="/rules" className="text-xs text-slate-400 hover:text-blue-600">
                      no rule · add one
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
