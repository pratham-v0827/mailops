'use client';

import type { Settings } from '@mailops/schema';
import Link from 'next/link';
import { useState } from 'react';
import { AppShell, Card } from '../../components/AppShell';
import { useAuth } from '../../components/AuthProvider';
import { ConnectEngine } from '../../components/ConnectEngine';
import { McpTokens } from '../../components/McpTokens';
import { useMailboxes } from '../../components/MailboxProvider';
import { Button, errorText, inputCls, Notice, PageHeader, WithMailbox } from '../../components/ui';
import type { MailboxView } from '../../lib/api-types';

export default function SettingsPage() {
  return (
    <AppShell>
      <WithMailbox>{(m) => <SettingsForm mailbox={m} />}</WithMailbox>
    </AppShell>
  );
}

type Field =
  | { key: keyof Settings; kind: 'bool'; label: string; help?: string }
  | { key: keyof Settings; kind: 'num'; label: string; help?: string; min: number; max: number }
  | { key: keyof Settings; kind: 'text'; label: string; help?: string };

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: 'Mode',
    fields: [
      {
        key: 'automationEnabled',
        kind: 'bool',
        label: 'Automation enabled',
        help: 'Run the nightly pass.',
      },
      {
        key: 'dryRun',
        kind: 'bool',
        label: 'Dry run (preview only)',
        help: 'While on, nothing in Gmail changes; the Activity page shows what would happen.',
      },
    ],
  },
  {
    title: 'Safety guards (enforced by the engine in your account)',
    fields: [
      { key: 'neverTouchStarred', kind: 'bool', label: 'Never touch starred mail' },
      { key: 'neverTouchImportant', kind: 'bool', label: 'Never touch Important mail' },
      {
        key: 'protectedLabel',
        kind: 'text',
        label: 'Protected label',
        help: 'Mail with this label is never archived or trashed. Blank = none.',
      },
      {
        key: 'maxTrashPerPass',
        kind: 'num',
        min: 0,
        max: 5000,
        label: 'Most messages moved to Trash per pass',
      },
      {
        key: 'newRulePreviewHours',
        kind: 'num',
        min: 0,
        max: 168,
        label: 'Preview changed rules for (hours)',
        help: '0 = act immediately.',
      },
    ],
  },
  {
    title: 'Schedule',
    fields: [
      {
        key: 'timezone',
        kind: 'text',
        label: 'Time zone',
        help: 'IANA name, e.g. Asia/Kolkata or Europe/London.',
      },
      { key: 'dailyHour', kind: 'num', min: 0, max: 23, label: 'Nightly pass hour (0–23)' },
      { key: 'maxMessagesPerBatch', kind: 'num', min: 10, max: 150, label: 'Messages per batch' },
      { key: 'maxRuntimeSeconds', kind: 'num', min: 60, max: 300, label: 'Seconds per batch' },
    ],
  },
  {
    title: 'Privacy and monitoring',
    fields: [
      {
        key: 'storeSubjects',
        kind: 'bool',
        label: 'Store email subjects in Activity',
        help: 'Off: only the sender’s domain, label and action are stored.',
      },
      { key: 'retentionDays', kind: 'num', min: 7, max: 365, label: 'Keep activity for (days)' },
      {
        key: 'emailAlerts',
        kind: 'bool',
        label: 'Email me when a run fails or the nightly pass is overdue',
      },
      {
        key: 'staleAfterHours',
        kind: 'num',
        min: 1,
        max: 168,
        label: 'Show the engine as STALE after (hours)',
      },
    ],
  },
];

function SettingsForm({ mailbox }: { mailbox: MailboxView }) {
  const { api } = useAuth();
  const { reload } = useMailboxes();
  const [values, setValues] = useState<Settings>(mailbox.settings);
  const [name, setName] = useState(mailbox.displayName);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const changed = Object.fromEntries(
    Object.entries(values).filter(([k, v]) => mailbox.settings[k as keyof Settings] !== v),
  ) as Partial<Settings>;
  const dirty = Object.keys(changed).length > 0 || name !== mailbox.displayName;
  const turningOnProduction =
    values.automationEnabled &&
    !values.dryRun &&
    !(mailbox.settings.automationEnabled && !mailbox.settings.dryRun);
  const weakening =
    (mailbox.settings.neverTouchStarred && !values.neverTouchStarred) ||
    (mailbox.settings.neverTouchImportant && !values.neverTouchImportant) ||
    (!!mailbox.settings.protectedLabel && !values.protectedLabel);

  async function save() {
    if (
      turningOnProduction &&
      !window.confirm(
        'Turn on production? From the next pass, MailOps archives and moves mail to Trash for real (Trash stays recoverable for 30 days).',
      )
    )
      return;
    if (weakening && !window.confirm('You are switching off a safety guard. Continue?')) return;
    setBusy(true);
    setNote(null);
    try {
      await api(`/api/web/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(name !== mailbox.displayName ? { displayName: name } : {}),
          ...(Object.keys(changed).length ? { settings: changed } : {}),
        }),
      });
      await reload();
      setNote({
        tone: 'good',
        text: 'Saved. The engine picks this up on its next sync (within 15 minutes).',
      });
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle={mailbox.email}>
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </PageHeader>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      <Card title="Mailbox">
        <label className="block max-w-sm space-y-1 text-sm">
          <span className="text-slate-500">Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Personal"
            className={inputCls}
          />
        </label>
      </Card>

      {SECTIONS.map((s) => (
        <Card key={s.title} title={s.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            {s.fields.map((f) => (
              <div key={f.key} className="text-sm">
                {f.kind === 'bool' ? (
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={values[f.key] as boolean}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
                    />
                    <span>
                      {f.label}
                      {f.help && <span className="block text-xs text-slate-500">{f.help}</span>}
                    </span>
                  </label>
                ) : (
                  <label className="block space-y-1">
                    <span className="text-slate-500">{f.label}</span>
                    <input
                      value={String(values[f.key])}
                      inputMode={f.kind === 'num' ? 'numeric' : undefined}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [f.key]:
                            f.kind === 'num'
                              ? Math.max(f.min, Math.min(f.max, Number(e.target.value) || 0))
                              : e.target.value,
                        })
                      }
                      className={inputCls}
                    />
                    {f.help && <span className="block text-xs text-slate-500">{f.help}</span>}
                  </label>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card title="Engine connection">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          New engines connect with a pairing code: run <code>setup</code> in Apps Script and approve
          the code (see{' '}
          <Link href="/setup" className="text-blue-600 hover:underline">
            Setup
          </Link>
          ). A connector token is only needed for the older Sheet-based engine.
        </p>
        <ConnectEngine mailbox={mailbox} />
      </Card>

      <Card title="Claude (MCP) access">
        <McpTokens />
      </Card>
    </div>
  );
}
