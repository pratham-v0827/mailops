'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, Card, ErrorNote } from '../../components/AppShell';
import { ApiError, useAuth } from '../../components/AuthProvider';
import type { MeResponse } from '../../lib/api-types';

function engineStatus(me: MeResponse) {
  const e = me.engine;
  if (!e?.lastSeenAt)
    return {
      label: 'Not connected',
      tone: 'warn' as const,
      note: 'Connect your Apps Script engine (coming in M3).',
    };
  const hours = (Date.now() - new Date(e.lastSeenAt).getTime()) / 36e5;
  if (hours > me.settings.staleAfterHours) {
    return {
      label: 'STALE',
      tone: 'warn' as const,
      note: `No heartbeat for ${Math.floor(hours)} h.`,
    };
  }
  return {
    label: 'Healthy',
    tone: 'good' as const,
    note: `Last seen ${new Date(e.lastSeenAt).toLocaleString()}.`,
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
  const { api } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api<MeResponse>('/api/web/me').then(setMe, setError);
  }, [api]);

  if (error) return <ErrorNote status={error.status} message={error.message} />;
  if (!me) return <p className="text-sm text-slate-500">Loading…</p>;

  const engine = engineStatus(me);
  const s = me.settings;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-slate-500">{me.email}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Engine" tone={engine.tone}>
          <p className="text-xl font-semibold">{engine.label}</p>
          <p className="mt-1 text-xs text-slate-500">{engine.note}</p>
        </Card>
        <Card title="Mode" tone={s.dryRun ? 'warn' : 'good'}>
          <p className="text-xl font-semibold">{s.dryRun ? 'Dry run' : 'Production'}</p>
          <p className="mt-1 text-xs text-slate-500">
            Automation {s.automationEnabled ? 'enabled' : 'disabled'}
          </p>
        </Card>
        <Card title="Rules">
          <p className="text-xl font-semibold">{me.ruleCount}</p>
          <Link href="/rules" className="mt-1 inline-block text-xs text-blue-600 hover:underline">
            {me.ruleCount ? 'View rules →' : 'Import rules →'}
          </Link>
        </Card>
        <Card title="Pending proposals" tone={me.pendingProposals ? 'warn' : 'default'}>
          <p className="text-xl font-semibold">{me.pendingProposals}</p>
          <p className="mt-1 text-xs text-slate-500">Changes waiting for your approval</p>
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
    </div>
  );
}
