'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { useAuth } from '../../components/AuthProvider';
import {
  Badge,
  Button,
  Empty,
  errorText,
  inputCls,
  Notice,
  PageHeader,
  Table,
  when,
  WithMailbox,
} from '../../components/ui';
import type { EventsResponse, EventView, MailboxView } from '../../lib/api-types';

export default function ActivityPage() {
  return (
    <AppShell>
      <WithMailbox>{(m) => <Activity mailbox={m} />}</WithMailbox>
    </AppShell>
  );
}

const ACTION_TONE = { archive: 'info', trash: 'bad', protect: 'good' } as const;

function gmailLink(m: MailboxView, e: EventView) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(m.email)}#all/${e.messageId}`;
}

function Activity({ mailbox }: { mailbox: MailboxView }) {
  const { api } = useAuth();
  const [action, setAction] = useState('');
  const [runId, setRunId] = useState('');
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('run');
    if (r) setRunId(r);
  }, []);

  const fetchPage = useCallback(
    async (before?: string) => {
      const q = new URLSearchParams({ limit: '100' });
      if (action) q.set('action', action);
      if (runId) q.set('runId', runId);
      if (before) q.set('before', before);
      const res = await api<EventsResponse>(`/api/web/mailboxes/${mailbox.id}/events?${q}`);
      setMore(res.events.length === 100);
      return res.events;
    },
    [api, mailbox.id, action, runId],
  );

  useEffect(() => {
    setEvents(null);
    fetchPage().then(setEvents, (e) => setError(errorText(e)));
  }, [fetchPage]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle={`What MailOps did (or would do, in a preview) to each message · kept ${mailbox.settings.retentionDays} days`}
      >
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={`${inputCls} w-40`}
        >
          <option value="">All actions</option>
          <option value="archive">Archive</option>
          <option value="trash">Trash</option>
          <option value="protect">Protected</option>
        </select>
        {runId && (
          <Button kind="secondary" onClick={() => setRunId('')}>
            Run {runId.slice(0, 15)}… ✕
          </Button>
        )}
      </PageHeader>
      {!mailbox.settings.storeSubjects && (
        <p className="text-xs text-slate-500">
          Subjects aren’t stored (Settings → Privacy). Open a message in Gmail to see it.
        </p>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {!events ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <Empty>No activity yet. It appears after the engine’s first run.</Empty>
      ) : (
        <>
          <Table
            head={[
              'When',
              'Action',
              'Label',
              'From',
              mailbox.settings.storeSubjects ? 'Subject' : 'Age',
              'Why',
              '',
            ]}
          >
            {events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-xs text-slate-500" title={e.at}>
                  {when(e.at)}
                </td>
                <td className="whitespace-nowrap">
                  <Badge tone={ACTION_TONE[e.action]}>{e.action}</Badge>{' '}
                  {e.preview && <Badge>{e.mode === 'dry' ? 'dry run' : 'preview'}</Badge>}
                </td>
                <td className="max-w-[14rem] truncate" title={e.label}>
                  {e.label}
                </td>
                <td className="text-slate-600 dark:text-slate-300">{e.senderDomain || '—'}</td>
                <td className="max-w-[18rem] truncate" title={e.subject ?? ''}>
                  {mailbox.settings.storeSubjects ? (e.subject ?? '—') : `${e.ageDays} d old`}
                </td>
                <td className="max-w-[16rem] truncate text-xs text-slate-500" title={e.reason}>
                  {e.reason}
                </td>
                <td>
                  <a
                    href={gmailLink(mailbox, e)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Gmail ↗
                  </a>
                </td>
              </tr>
            ))}
          </Table>
          {more && (
            <Button
              kind="secondary"
              onClick={async () => {
                try {
                  const next = await fetchPage(events.at(-1)!.at);
                  setEvents([...events, ...next]);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
