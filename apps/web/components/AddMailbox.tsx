'use client';

import { NewMailbox } from '@mailops/schema';
import { useState } from 'react';
import type { MailboxView } from '../lib/api-types';
import { useAuth } from './AuthProvider';
import { useMailboxes } from './MailboxProvider';

/** Form to add a Gmail address. Each mailbox gets its own rules, settings and engine. */
export function AddMailbox({
  suggestedEmail = '',
  onAdded,
}: {
  suggestedEmail?: string;
  onAdded?: () => void;
}) {
  const { api } = useAuth();
  const { reload, select } = useMailboxes();
  const [email, setEmail] = useState(suggestedEmail);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = NewMailbox.safeParse({ email, displayName });
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api<{ mailbox: MailboxView }>('/api/web/mailboxes', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      await reload();
      select(res.mailbox.id);
      setEmail('');
      setDisplayName('');
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      <label className="space-y-1">
        <span className="block text-slate-500">Gmail address</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@gmail.com"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
        />
      </label>
      <label className="space-y-1">
        <span className="block text-slate-500">Name (optional)</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Personal, Work…"
          className="w-44 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
        />
      </label>
      <button
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        {busy ? 'Adding…' : 'Add mailbox'}
      </button>
      {error && <p className="w-full text-red-600">{error}</p>}
    </form>
  );
}
