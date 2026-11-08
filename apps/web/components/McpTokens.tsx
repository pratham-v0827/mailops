'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { Badge, Button, errorText, inputCls, when } from './ui';

type TokenRow = {
  id: string;
  name: string;
  scopes: ('read' | 'propose')[];
  createdAt: string | null;
  lastUsedAt: string | null;
};

/** Personal access tokens that let Claude read MailOps and propose changes (never approve). */
export function McpTokens() {
  const { api } = useAuth();
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState('Claude');
  const [canPropose, setCanPropose] = useState(true);
  const [fresh, setFresh] = useState('');
  const [error, setError] = useState('');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const endpoint = `${origin}/api/mcp`;

  const load = useCallback(() => {
    api<{ tokens: TokenRow[] }>('/api/web/mcp-tokens').then(
      (r) => setTokens(r.tokens),
      (e) => setError(errorText(e)),
    );
  }, [api]);
  useEffect(load, [load]);

  async function create() {
    setError('');
    try {
      const r = await api<{ token: string }>('/api/web/mcp-tokens', {
        method: 'POST',
        body: JSON.stringify({ name, scopes: canPropose ? ['read', 'propose'] : ['read'] }),
      });
      setFresh(r.token);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this token? Claude loses access straight away.')) return;
    await api(`/api/web/mcp-tokens/${id}`, { method: 'DELETE' }).catch((e) =>
      setError(errorText(e)),
    );
    load();
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600 dark:text-slate-300">
        Connect Claude to MailOps over MCP. Claude can read your rules, labels, filters and
        activity, and <b>propose</b> changes; you approve them on the Proposals page. It can never
        approve, delete, or turn production on.
      </p>
      <p className="text-slate-600 dark:text-slate-300">
        <b>claude.ai or Claude Desktop:</b> Settings → Connectors → Add custom connector, URL{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{endpoint}</code>. You sign in
        with Google; no token needed.{' '}
        <Button
          kind="link"
          onClick={async () => {
            if (!window.confirm('Disconnect all Claude connectors that signed in with OAuth?'))
              return;
            await api('/api/web/mcp-tokens/oauth', { method: 'DELETE' }).catch((e) =>
              setError(errorText(e)),
            );
          }}
        >
          Disconnect connectors
        </Button>
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-slate-500">Token name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputCls} w-48`}
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={canPropose}
            onChange={(e) => setCanPropose(e.target.checked)}
          />
          Can propose changes
        </label>
        <Button onClick={create} disabled={!name.trim()}>
          Create token
        </Button>
      </div>

      {fresh && (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
          <p className="font-medium">Token (shown once):</p>
          <code className="block overflow-x-auto rounded bg-white px-2 py-1.5 font-mono text-xs dark:bg-slate-900">
            {fresh}
          </code>
          <p className="text-xs">Claude Code:</p>
          <code className="block overflow-x-auto whitespace-pre rounded bg-white px-2 py-1.5 font-mono text-xs dark:bg-slate-900">
            {`claude mcp add --transport http mailops ${endpoint} --header "Authorization: Bearer ${fresh}"`}
          </code>
          <Button kind="link" onClick={() => setFresh('')}>
            I’ve saved it
          </Button>
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}

      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{t.name}</span>{' '}
                {t.scopes.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
                <span className="block text-xs text-slate-500">
                  created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                </span>
              </span>
              <Button kind="danger" onClick={() => revoke(t.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
