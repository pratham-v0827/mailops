'use client';

import { FilterCriteria } from '@mailops/schema';
import { useState } from 'react';
import { AppShell } from '../../components/AppShell';
import {
  Badge,
  Button,
  Empty,
  errorText,
  inputCls,
  Modal,
  Notice,
  PageHeader,
  Table,
  useCommand,
  useMailboxResource,
  when,
  WithMailbox,
} from '../../components/ui';
import type { FiltersResponse, FilterView } from '../../lib/api-types';

export default function FiltersPage() {
  return (
    <AppShell>
      <WithMailbox>{() => <Filters />}</WithMailbox>
    </AppShell>
  );
}

function criteriaText(c: FilterView['criteria']) {
  return Object.entries(c)
    .map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`))
    .join(' · ');
}

/** A filter is healthy when (almost) every matching message in the last 30 days has its label. */
function health(f: FilterView) {
  const h = f.health;
  if (!h) return <span className="text-xs text-slate-400">not checked yet</span>;
  if (h.matched30d === 0) return <Badge>no mail in 30 d</Badge>;
  const pct = Math.round((h.labelled30d / h.matched30d) * 100);
  return (
    <span title={`checked ${when(h.checkedAt)}`}>
      <Badge tone={pct >= 95 ? 'good' : pct >= 70 ? 'warn' : 'bad'}>{pct}%</Badge>{' '}
      <span className="text-xs text-slate-500">
        {h.labelled30d}/{h.matched30d}
      </span>
    </span>
  );
}

function Filters() {
  const { data, error } = useMailboxResource<FiltersResponse>('/filters');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState('');

  if (error) return <Notice tone="bad">{error.message}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const shown = data.filters.filter((f) =>
    (criteriaText(f.criteria) + ' ' + f.addLabels.join(' '))
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const unhealthy = data.filters.filter(
    (f) => f.health && f.health.matched30d > 0 && f.health.labelled30d / f.health.matched30d < 0.7,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Filters"
        subtitle={`${data.filters.length} Gmail filters · reported ${when(data.updatedAt)}${unhealthy ? ` · ${unhealthy} need attention` : ''}`}
      >
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className={`${inputCls} w-48`}
        />
        <Button onClick={() => setCreating(true)}>New filter</Button>
      </PageHeader>
      <p className="text-xs text-slate-500">
        Health: of the messages that matched a filter in the last 30 days, how many carry its label.
        MailOps adds filters but never edits or deletes them.
      </p>
      {note && <Notice tone="good">{note}</Notice>}
      {shown.length === 0 ? (
        <Empty>
          {data.updatedAt ? 'No filters match.' : 'The engine hasn’t sent your filters yet.'}
        </Empty>
      ) : (
        <Table head={['Matches', 'Adds label', 'Also', 'Health (30 d)']}>
          {shown.map((f) => (
            <tr key={f.id}>
              <td className="max-w-[28rem] font-mono text-xs">{criteriaText(f.criteria)}</td>
              <td className="text-sm">
                {f.addLabels.filter((l) => l !== 'IMPORTANT').join(', ') || '—'}
              </td>
              <td className="text-xs text-slate-500">
                {[
                  f.removeLabels.includes('INBOX') && 'skip inbox',
                  f.removeLabels.includes('UNREAD') && 'mark read',
                  f.addLabels.includes('IMPORTANT') && 'important',
                  f.forward && `forward to ${f.forward}`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </td>
              <td className="whitespace-nowrap">{health(f)}</td>
            </tr>
          ))}
        </Table>
      )}
      {creating && (
        <NewFilter
          onClose={() => setCreating(false)}
          onQueued={(label) => {
            setCreating(false);
            setNote(`Queued: the engine creates the filter for “${label}” on its next sync.`);
          }}
        />
      )}
    </div>
  );
}

function NewFilter({
  onClose,
  onQueued,
}: {
  onClose: () => void;
  onQueued: (label: string) => void;
}) {
  const command = useCommand();
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState('');
  const [archive, setArchive] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const criteria = FilterCriteria.safeParse({
      ...(from.trim() ? { from: from.trim() } : {}),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      ...(query.trim() ? { query: query.trim() } : {}),
    });
    if (!criteria.success) {
      setError('Fill in at least one of From, Subject or Has the words.');
      return;
    }
    try {
      await command({
        kind: 'filter.create',
        criteria: criteria.data,
        addLabel: label.trim(),
        archive,
      });
      onQueued(label.trim());
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal title="New Gmail filter" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {[
          ['From', from, setFrom, 'news@example.com OR example.org'],
          ['Subject', subject, setSubject, 'Your statement'],
          ['Has the words', query, setQuery, 'list:(<newsletter.example.com>)'],
          ['Apply label', label, setLabel, 'Newsletters/Example'],
        ].map(([t, v, set, ph]) => (
          <label key={t as string} className="block space-y-1">
            <span className="text-slate-500">{t as string}</span>
            <input
              value={v as string}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
              placeholder={ph as string}
              className={inputCls}
            />
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />{' '}
          Skip the inbox (archive on arrival)
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!label.trim()}>
          Create filter
        </Button>
      </div>
    </Modal>
  );
}
