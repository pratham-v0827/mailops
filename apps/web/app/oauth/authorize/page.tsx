'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../components/AuthProvider';

type Client = { name: string; redirectUris: string[] };

const SCOPE_TEXT: Record<string, string> = {
  read: 'See your MailOps mailboxes, rules, labels, filters, runs and activity',
  propose: 'Propose rules, labels, filters and dry runs (you approve each one on the dashboard)',
};

/** OAuth consent screen for MCP clients such as claude.ai custom connectors. */
export default function AuthorizePage() {
  const { user, loading, signIn, api } = useAuth();
  const params = useMemo(
    () =>
      typeof window === 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? undefined;
  const scopes = (params.get('scope') ?? 'read propose')
    .split(/\s+/)
    .filter((s) => s in SCOPE_TEXT);

  useEffect(() => {
    if (params.get('response_type') !== 'code') {
      setError('Unsupported request (response_type must be "code").');
      return;
    }
    if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) {
      setError('This app must use PKCE (S256).');
      return;
    }
    fetch(`/api/oauth/client?client_id=${encodeURIComponent(clientId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Unknown app. Remove and add the connector again.');
        const c = (await r.json()) as Client;
        if (!c.redirectUris.includes(redirectUri))
          throw new Error('This app sent an unregistered redirect address.');
        setClient(c);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [clientId, redirectUri, params]);

  async function allow() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ redirect: string }>('/api/oauth/authorize', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: params.get('code_challenge'),
          code_challenge_method: 'S256',
          scope: scopes.join(' '),
          ...(state ? { state } : {}),
          ...(params.get('resource') ? { resource: params.get('resource') } : {}),
        }),
      });
      window.location.assign(res.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function deny() {
    if (!client) return;
    const u = new URL(redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (state) u.searchParams.set('state', state);
    window.location.assign(u.toString());
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold tracking-tight">Connect to MailOps</h1>
        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        ) : !client || loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : !user ? (
          <>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              <b>{client.name}</b> wants to connect to your MailOps account. Sign in first.
            </p>
            <button
              onClick={() => signIn().catch((e) => setError(String(e?.message ?? e)))}
              className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
            >
              Sign in with Google
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              <b>{client.name}</b> wants to access MailOps as <b>{user.email}</b>. It will be able
              to:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {scopes.map((s) => (
                <li key={s}>{SCOPE_TEXT[s]}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              It can never approve changes, delete anything, or turn production on. It never sees
              email content. You can disconnect it any time in Settings. Redirects to{' '}
              {new URL(redirectUri).host}.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                disabled={busy}
                onClick={allow}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                Allow
              </button>
              <button
                disabled={busy}
                onClick={deny}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm dark:border-slate-700"
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
