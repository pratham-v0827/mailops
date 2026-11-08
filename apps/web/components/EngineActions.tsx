'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CommandsResponse, CommandView, MailboxView } from '../lib/api-types';
import { ENGINE_LATEST_VERSION } from '../lib/version';
import { useAuth } from './AuthProvider';
import { Badge, Button, errorText, when } from './ui';

const LABEL: Record<string, string> = {
  'run.start': 'Start pass',
  'run.stop': 'Stop pass',
  'label.create': 'Create label',
  'filter.create': 'Create filter',
  'mirror.refresh': 'Refresh labels and filters',
};

function older(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

/** Start or stop passes on the engine and show the latest commands and their results. */
export function EngineActions({ mailbox }: { mailbox: MailboxView }) {
  const { api } = useAuth();
  const [commands, setCommands] = useState<CommandView[]>([]);
  const [error, setError] = useState('');
  const base = `/api/web/mailboxes/${mailbox.id}/commands`;
  const prod = mailbox.settings.automationEnabled && !mailbox.settings.dryRun;
  const state = mailbox.engine?.state;
  const version = mailbox.engine?.engineVersion ?? '';
  const legacy = version !== '' && older(version, '3.0.0');

  const load = useCallback(() => {
    api<CommandsResponse>(base).then(
      (r) => setCommands(r.commands.slice(0, 5)),
      () => {},
    );
  }, [api, base]);
  useEffect(load, [load]);

  async function send(payload: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError('');
    try {
      await api(base, { method: 'POST', body: JSON.stringify({ payload }) });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!mailbox.connected) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        No engine connected.{' '}
        <Link href="/setup" className="text-blue-600 hover:underline">
          Set it up
        </Link>{' '}
        to run passes from here.
      </p>
    );
  }

  if (legacy) {
    return (
      <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
        <p>
          This mailbox runs the Sheet-based engine v{version}: it reports runs here, but takes its
          rules and commands from the Sheet.
        </p>
        <Link href="/setup" className="text-blue-600 hover:underline">
          Install engine {ENGINE_LATEST_VERSION} →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {state?.sessionActive ? (
        <p>
          <Badge tone="info">
            {state.sessionMode === 'prod' ? 'Production' : 'Dry run'} pass running
          </Badge>
        </p>
      ) : (
        <p className="text-slate-500">
          No pass running.{' '}
          {state?.lastPassCompletedAt && <>Last pass finished {when(state.lastPassCompletedAt)}.</>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => send({ kind: 'run.start', mode: 'dry' })}>Start dry run</Button>
        <Button
          kind="secondary"
          disabled={!prod}
          onClick={() =>
            send(
              { kind: 'run.start', mode: 'prod' },
              'Run a production pass now? Mail will be archived and moved to Trash by your rules.',
            )
          }
        >
          Run production now
        </Button>
        {state?.sessionActive && (
          <Button kind="danger" onClick={() => send({ kind: 'run.stop' })}>
            Stop
          </Button>
        )}
      </div>
      {!prod && (
        <p className="text-xs text-slate-500">
          Production is off (Settings). Commands run on the engine’s next sync, within 15 minutes.
        </p>
      )}
      {version && older(version, ENGINE_LATEST_VERSION) && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Engine v{version} · v{ENGINE_LATEST_VERSION} is available (see the engine README).
        </p>
      )}
      {state?.usingCachedConfig && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The engine couldn’t reach the dashboard on its last sync.
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
      {commands.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
          {commands.map((c) => (
            <li key={c.id} className="flex justify-between gap-2">
              <span>
                {LABEL[c.payload.kind] ?? c.payload.kind}
                {c.payload.kind === 'run.start' ? ` (${String(c.payload.mode)})` : ''}
                <span className="text-slate-500"> · {when(c.createdAt)}</span>
              </span>
              <span title={c.result?.message ?? ''}>
                <Badge
                  tone={c.status === 'done' ? 'good' : c.status === 'failed' ? 'bad' : 'default'}
                >
                  {c.status}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
