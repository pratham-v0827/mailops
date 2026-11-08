'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AddMailbox } from '../../components/AddMailbox';
import { AppShell, Card, ErrorNote } from '../../components/AppShell';
import { EngineActions } from '../../components/EngineActions';
import { RecentRuns } from '../../components/RecentRuns';
import { mailboxLabel, useMailboxes } from '../../components/MailboxProvider';
import type { MailboxView } from '../../lib/api-types';

function engineStatus(m: MailboxView) {
  const e = m.engine;
  if (!m.connected || !e?.lastSeenAt) {
    return {
      label: 'Not connected',
      tone: 'warn' as const,
      note: m.hasConnector
        ? 'Token created; waiting for the engine to check in.'
        : 'Install the engine for this Gmail account (Setup).',
    };
  }
  const hours = (Date.now() - new Date(e.lastSeenAt).getTime()) / 36e5;
  if (hours > m.settings.staleAfterHours) {
    return {
      label: 'STALE',
      tone: 'warn' as const,
      note: `No heartbeat for ${Math.floor(hours)} h.`,
    };
  }
  return {
    label: 'Healthy',
    tone: 'good' as const,
    note: `Last seen ${new Date(e.lastSeenAt).toLocaleString()}${e.engineVersion ? ` · v${e.engineVersion}` : ''}.`,
  };
}

/** Prefer what the engine reports; fall back to the dashboard's own setting. */
function modeOf(m: MailboxView) {
  const e = m.engine;
  if (e?.reportedMode) {
    return {
      dry: e.reportedMode === 'dry',
      automation: e.reportedAutomationEnabled ?? m.settings.automationEnabled,
      source: 'reported by the engine',
    };
  }
  return {
    dry: m.settings.dryRun,
    automation: m.settings.automationEnabled,
    source: 'dashboard default',
  };
}

export default function OverviewPage() {
  return (
    <AppShell>
      <Overview />
    </AppShell>
  );
}

function Overview() {
  const { email, mailboxes, selected, select, error, loading } = useMailboxes();
  const [adding, setAdding] = useState(false);

  if (error) return <ErrorNote status={error.status} message={error.message} />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  if (mailboxes.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to MailOps</h1>
        <Card title="Connect your first Gmail account">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            MailOps runs a small Apps Script in your own Google account and you control it from
            here. Setup takes about 5 minutes.
          </p>
          <Link
            href="/setup"
            className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
          >
            Start setup →
          </Link>
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-slate-500">
              Or add a mailbox without an engine yet
            </summary>
            <div className="mt-3">
              <AddMailbox suggestedEmail={email} />
            </div>
          </details>
        </Card>
      </div>
    );
  }

  const m = selected ?? mailboxes[0]!;
  const engine = engineStatus(m);
  const mode = modeOf(m);
  const s = m.settings;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-slate-500">{mailboxLabel(m)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Engine" tone={engine.tone}>
          <p className="text-xl font-semibold">{engine.label}</p>
          <p className="mt-1 text-xs text-slate-500">{engine.note}</p>
        </Card>
        <Card title="Mode" tone={mode.dry ? 'warn' : 'good'}>
          <p className="text-xl font-semibold">{mode.dry ? 'Dry run' : 'Production'}</p>
          <p className="mt-1 text-xs text-slate-500">
            Automation {mode.automation ? 'enabled' : 'disabled'} · {mode.source}
          </p>
        </Card>
        <Card title="Rules">
          <p className="text-xl font-semibold">{m.ruleCount}</p>
          <Link href="/rules" className="mt-1 inline-block text-xs text-blue-600 hover:underline">
            {m.ruleCount ? 'View rules →' : 'Import rules →'}
          </Link>
        </Card>
        <Card title="Pending proposals" tone={m.pendingProposals ? 'warn' : 'default'}>
          <p className="text-xl font-semibold">{m.pendingProposals}</p>
          <Link
            href="/proposals"
            className="mt-1 inline-block text-xs text-blue-600 hover:underline"
          >
            {m.pendingProposals ? 'Review →' : 'Changes waiting for your approval'}
          </Link>
        </Card>
      </div>

      <Card title="Safety guards">
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          <li>{s.neverTouchStarred ? '✅' : '⚠️'} Never touch starred mail</li>
          <li>{s.neverTouchImportant ? '✅' : '⚠️'} Never touch Important mail</li>
          <li>
            {s.protectedLabel ? `✅ Never touch “${s.protectedLabel}”` : '⚠️ No protected label'}
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          MailOps only moves mail to Trash (recoverable for 30 days). It never deletes permanently.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Actions" tone={m.connected ? 'default' : 'warn'}>
          <EngineActions key={m.id} mailbox={m} />
        </Card>
        <div className="lg:col-span-2">
          <Card title="Recent runs">
            <RecentRuns key={m.id} mailboxId={m.id} />
            <Link href="/runs" className="mt-3 inline-block text-xs text-blue-600 hover:underline">
              All runs →
            </Link>
          </Card>
        </div>
      </div>

      <Card title={`All mailboxes (${mailboxes.length})`}>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Mailbox</th>
              <th className="py-2">Engine</th>
              <th className="py-2">Mode</th>
              <th className="py-2">Rules</th>
              <th className="py-2">Pending</th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((x) => (
              <tr
                key={x.id}
                onClick={() => select(x.id)}
                className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${
                  x.id === m.id ? 'font-medium' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <td className="py-2">{mailboxLabel(x)}</td>
                <td className="py-2">{engineStatus(x).label}</td>
                <td className="py-2">{modeOf(x).dry ? 'Dry run' : 'Production'}</td>
                <td className="py-2">{x.ruleCount}</td>
                <td className="py-2">{x.pendingProposals}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4">
          {adding ? (
            <AddMailbox onAdded={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="text-sm text-blue-600 hover:underline"
            >
              + Add another mailbox
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
