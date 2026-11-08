'use client';

import { Rule } from '@mailops/schema';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, Card, ErrorNote } from '../../components/AppShell';
import { ApiError, useAuth } from '../../components/AuthProvider';
import { mailboxLabel, useMailboxes } from '../../components/MailboxProvider';
import type { ProposalsResponse, ProposalView, RulesResponse } from '../../lib/api-types';

type RuleRow = RulesResponse['rules'][number];

export default function RulesPage() {
  return (
    <AppShell>
      <RulesForSelectedMailbox />
    </AppShell>
  );
}

function days(v: number | null) {
  return v === null ? '—' : `${v} d`;
}

function RulesForSelectedMailbox() {
  const { selected, loading, error } = useMailboxes();
  if (error) return <ErrorNote status={error.status} message={error.message} />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!selected) {
    return (
      <p className="text-sm text-slate-500">
        Add a mailbox on the{' '}
        <Link href="/dashboard" className="text-blue-600 hover:underline">
          Overview
        </Link>{' '}
        first.
      </p>
    );
  }
  // Remount per mailbox so state never leaks between mailboxes.
  return (
    <Rules
      key={selected.id}
      base={`/api/web/mailboxes/${selected.id}`}
      title={mailboxLabel(selected)}
    />
  );
}

function Rules({ base, title }: { base: string; title: string }) {
  const { api } = useAuth();
  const { reload: reloadMailboxes } = useMailboxes();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<RuleRow | null>(null);

  const load = useCallback(() => {
    api<RulesResponse>(`${base}/rules`).then((r) => setRules(r.rules), setError);
    api<ProposalsResponse>(`${base}/proposals`).then((p) => setProposals(p.proposals), setError);
  }, [api, base]);

  useEffect(load, [load]);

  // After a change, refresh this page and the mailbox counts shown elsewhere.
  const changed = useCallback(() => {
    load();
    void reloadMailboxes();
  }, [load, reloadMailboxes]);

  const shown = useMemo(
    () => (rules ?? []).filter((r) => r.label.toLowerCase().includes(filter.toLowerCase())),
    [rules, filter],
  );

  if (error) return <ErrorNote status={error.status} message={error.message} />;
  if (!rules) return <p className="text-sm text-slate-500">Loading…</p>;
  if (rules.length === 0) return <ImportRules base={base} title={title} onDone={changed} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="text-sm text-slate-500">
            {title} · {rules.length} rules · changes are proposals until you approve them
          </p>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter labels…"
          className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {proposals.length > 0 && (
        <Card title={`Pending proposals (${proposals.length})`} tone="warn">
          <ul className="space-y-1 text-sm">
            {proposals.map((p) => (
              <li key={p.id}>
                <span className="font-mono text-xs text-slate-500">{p.payload.kind}</span>{' '}
                {'rule' in p.payload
                  ? p.payload.rule.label
                  : 'label' in p.payload
                    ? String(p.payload.label)
                    : ''}
                <span className="text-slate-500"> · from {p.source}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Approval and engine apply arrive in M3–M4.</p>
        </Card>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Archive after</th>
              <th className="px-4 py-3">Trash after</th>
              <th className="px-4 py-3">Never delete</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${r.enabled ? '' : 'opacity-50'}`}
              >
                <td className="px-4 py-2.5 font-medium">{r.label}</td>
                <td className="px-4 py-2.5">{days(r.archiveAfterDays)}</td>
                <td className="px-4 py-2.5">{r.neverDelete ? 'never' : days(r.trashAfterDays)}</td>
                <td className="px-4 py-2.5">{r.neverDelete ? 'Yes' : ''}</td>
                <td className="px-4 py-2.5">{r.risk}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => setEditing(r)} className="text-blue-600 hover:underline">
                    Propose change
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProposeRule
          base={base}
          rule={editing}
          onClose={() => setEditing(null)}
          onSent={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

function ProposeRule({
  base,
  rule,
  onClose,
  onSent,
}: {
  base: string;
  rule: RuleRow;
  onClose: () => void;
  onSent: () => void;
}) {
  const { api } = useAuth();
  const [archive, setArchive] = useState(rule.archiveAfterDays?.toString() ?? '');
  const [trash, setTrash] = useState(rule.trashAfterDays?.toString() ?? '');
  const [neverDelete, setNeverDelete] = useState(rule.neverDelete);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  async function submit() {
    const { id: _id, ...base } = rule;
    const parsed = Rule.safeParse({
      ...base,
      enabled,
      neverDelete,
      archiveAfterDays: num(archive),
      trashAfterDays: neverDelete ? null : num(trash),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    try {
      await api(`${base}/proposals`, {
        method: 'POST',
        body: JSON.stringify({ payload: { kind: 'rule.upsert', rule: parsed.data }, reason }),
      });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Propose a change</h2>
        <p className="mt-1 text-sm text-slate-500">{rule.label}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-slate-500">Archive after (days)</span>
            <input
              value={archive}
              onChange={(e) => setArchive(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="space-y-1">
            <span className="text-slate-500">Trash after (days)</span>
            <input
              value={neverDelete ? '' : trash}
              disabled={neverDelete}
              onChange={(e) => setTrash(e.target.value)}
              inputMode="numeric"
              placeholder={neverDelete ? 'never' : 'blank = never'}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={neverDelete}
              onChange={(e) => setNeverDelete(e.target.checked)}
            />{' '}
            Never delete
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{' '}
            Enabled
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-slate-500">Reason (optional)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 text-sm">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white dark:bg-white dark:text-slate-900"
          >
            Create proposal
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportRules({ base, title, onDone }: { base: string; title: string; onDone: () => void }) {
  const { api } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function onFile(file: File | undefined) {
    if (file) setText(await file.text());
  }

  async function submit() {
    setBusy(true);
    setMessage('');
    try {
      const body = JSON.parse(text);
      const res = await api<{ imported: number }>(`${base}/rules/import`, {
        method: 'POST',
        body: JSON.stringify(Array.isArray(body) ? { rules: body } : body),
      });
      setMessage(`Imported ${res.imported} rules.`);
      onDone();
    } catch (e) {
      setMessage(
        e instanceof SyntaxError
          ? 'That is not valid JSON.'
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
      <Card title={`Import rules for ${title}`}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This mailbox has no rules yet. Import them once from a JSON file (an array of rules, or{' '}
          <code>{'{ "rules": [...] }'}</code>). After that, every change is a proposal you approve.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="mt-4 block text-sm"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder='[{ "label": "Newsletters", "archiveAfterDays": 1, "trashAfterDays": 15 }]'
          className="mt-3 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          disabled={busy || !text.trim()}
          onClick={submit}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {busy ? 'Importing…' : 'Import rules'}
        </button>
        {message && <p className="mt-3 text-sm">{message}</p>}
      </Card>
    </div>
  );
}
