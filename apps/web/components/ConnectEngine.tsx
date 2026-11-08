'use client';

import { useState } from 'react';
import type { MailboxView } from '../lib/api-types';
import { useAuth } from './AuthProvider';
import { useMailboxes } from './MailboxProvider';

/**
 * Issues a connector token for a mailbox and shows it exactly once. The user pastes it into the
 * engine running in that Gmail account (MailOps menu → Connect to MailOps dashboard…).
 */
export function ConnectEngine({ mailbox }: { mailbox: MailboxView }) {
  const { api } = useAuth();
  const { reload } = useMailboxes();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/web/mailboxes/${mailbox.id}/connector`;

  async function issue() {
    if (
      mailbox.hasConnector &&
      !window.confirm('Create a new token? The current one stops working immediately.')
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>(base, { method: 'POST' });
      setToken(res.token);
      setCopied(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (
      !window.confirm('Disconnect this engine? It will stop reporting until you connect again.')
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(base, { method: 'DELETE' });
      setToken('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {token ? (
        <>
          <p className="font-medium">Your connector token (shown once):</p>
          <div className="flex items-center gap-2">
            <code className="block flex-1 overflow-x-auto rounded-md bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-slate-800">
              {token}
            </code>
            <button
              onClick={copy}
              className="rounded-md border border-slate-300 px-3 py-1.5 dark:border-slate-700"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
            <li>
              Open the MailOps Control Center sheet signed in as <b>{mailbox.email}</b>.
            </li>
            <li>
              Menu <b>MailOps → Connect to MailOps dashboard…</b> and paste the token.
            </li>
            <li>This card turns green when the engine checks in.</li>
          </ol>
          <p className="text-xs text-slate-500">
            Treat it like a password: anyone with it can report runs for this mailbox. You can
            revoke it here at any time.
          </p>
        </>
      ) : (
        <p className="text-slate-600 dark:text-slate-300">
          {mailbox.connected
            ? 'Engine connected. Create a new token only if you need to reconnect or rotate it.'
            : mailbox.hasConnector
              ? 'A token exists but the engine has not checked in yet. Create a new one if you lost it.'
              : 'Connect the Apps Script engine running in this Gmail account so runs show up here.'}
        </p>
      )}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={issue}
          className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {mailbox.hasConnector ? 'Create new token' : 'Create connector token'}
        </button>
        {mailbox.hasConnector && (
          <button
            disabled={busy}
            onClick={revoke}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50 dark:border-slate-700"
          >
            Disconnect
          </button>
        )}
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
