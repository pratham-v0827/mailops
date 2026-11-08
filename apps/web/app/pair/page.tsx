'use client';

import { formatPairCode, PairCode } from '@mailops/schema';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, Card } from '../../components/AppShell';
import { useAuth } from '../../components/AuthProvider';
import { useMailboxes } from '../../components/MailboxProvider';
import { Button, errorText, inputCls, Notice, PageHeader } from '../../components/ui';
import type { PairInfo } from '../../lib/api-types';

export default function PairPage() {
  return (
    <AppShell>
      <Pair />
    </AppShell>
  );
}

/** Approves the pairing code an engine shows when you run `setup` in Apps Script. */
function Pair() {
  const { api } = useAuth();
  const { reload, select } = useMailboxes();
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ email: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(raw: string) {
    setError('');
    setInfo(null);
    const parsed = PairCode.safeParse(raw);
    if (!parsed.success) {
      setError('Codes look like ABCD-EFGH.');
      return;
    }
    try {
      setInfo(await api<PairInfo>(`/api/web/pair?code=${parsed.data}`));
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('code');
    if (c) {
      setCode(c);
      void lookup(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ mailboxId: string; email: string }>('/api/web/pair', {
        method: 'POST',
        body: JSON.stringify({ code, displayName: name }),
      });
      await reload();
      select(res.mailboxId);
      setDone({ email: res.email });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="Connect an engine"
        subtitle="Approve the code shown in your Apps Script execution log"
      />
      {done ? (
        <Notice tone="good">
          <p className="font-medium">Connected {done.email}.</p>
          <p className="mt-1">
            Apps Script finishes setup within a few seconds. Next:{' '}
            <Link href="/rules" className="underline">
              add or import rules
            </Link>
            , then start a dry run from the{' '}
            <Link href="/dashboard" className="underline">
              Overview
            </Link>
            .
          </p>
        </Notice>
      ) : (
        <Card title="Pairing code">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD-EFGH"
              className={`${inputCls} max-w-[12rem] font-mono uppercase tracking-widest`}
            />
            <Button kind="secondary" onClick={() => lookup(code)} disabled={!code.trim()}>
              Check
            </Button>
          </div>
          {info && (
            <div className="mt-5 space-y-4 text-sm">
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
                <p>
                  An engine running in <b>{info.email}</b> (verified by Google) wants to connect.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Code {formatPairCode(PairCode.parse(code))} · engine v{info.engineVersion} ·
                  expires {new Date(info.expiresAt).toLocaleTimeString()}
                </p>
              </div>
              {info.existingMailboxId ? (
                <p className="text-slate-600 dark:text-slate-300">
                  This replaces the current connection for that mailbox (its rules and history
                  stay).
                </p>
              ) : (
                <label className="block max-w-xs space-y-1">
                  <span className="text-slate-500">Name for this mailbox (optional)</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Personal, Work…"
                    className={inputCls}
                  />
                </label>
              )}
              <Notice tone="warn">
                Only approve a code you just saw in <b>your own</b> Apps Script project. Someone who
                sends you a code is trying to link their engine to your account.
              </Notice>
              <Button onClick={approve} disabled={busy}>
                {busy ? 'Approving…' : 'Approve and connect'}
              </Button>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </Card>
      )}
    </div>
  );
}
