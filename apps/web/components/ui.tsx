'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MailboxView } from '../lib/api-types';
import { ApiError, useAuth } from './AuthProvider';
import { ErrorNote } from './AppShell';
import { useMailboxes } from './MailboxProvider';

export const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950';

export function Button({
  children,
  onClick,
  disabled,
  kind = 'primary',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger' | 'link';
  type?: 'button' | 'submit';
}) {
  const cls = {
    primary:
      'rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200',
    secondary:
      'rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
    danger:
      'rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950',
    link: 'text-blue-600 hover:underline dark:text-blue-400',
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`text-sm disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-slate-100 [&>tr:last-child]:border-0 dark:[&>tr]:border-slate-800 [&_td]:px-4 [&_td]:py-2.5">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
}) {
  const cls = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    bad: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  }[tone];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString();
}

/**
 * The selected mailbox plus a loader for one of its API resources. Pages remount per mailbox
 * (keyed by id), so data never leaks between mailboxes.
 */
export function useMailboxResource<T>(path: string | null) {
  const { api } = useAuth();
  const { selected } = useMailboxes();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const base = selected ? `/api/web/mailboxes/${selected.id}` : null;

  const load = useCallback(async () => {
    if (!base || path === null) return;
    try {
      setData(await api<T>(`${base}${path}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    }
  }, [api, base, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load, base, api, mailbox: selected };
}

/** Renders the page body only when a mailbox is selected and loaded. */
export function WithMailbox({ children }: { children: (m: MailboxView) => React.ReactNode }) {
  const { selected, loading, error } = useMailboxes();
  if (error) return <ErrorNote status={error.status} message={error.message} />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!selected) {
    return (
      <Empty>
        No mailbox yet.{' '}
        <Link href="/setup" className="text-blue-600 hover:underline">
          Set up MailOps
        </Link>{' '}
        to connect your first Gmail account.
      </Empty>
    );
  }
  return <div key={selected.id}>{children(selected)}</div>;
}

/** Sends one command to the selected mailbox's engine. */
export function useCommand() {
  const { api } = useAuth();
  const { selected } = useMailboxes();
  return useCallback(
    async (payload: Record<string, unknown>) => {
      if (!selected) throw new Error('No mailbox selected');
      return api<{ id: string }>(`/api/web/mailboxes/${selected.id}/commands`, {
        method: 'POST',
        body: JSON.stringify({ payload }),
      });
    },
    [api, selected],
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'good' | 'warn' | 'bad';
}) {
  const cls = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
    bad: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
  }[tone];
  return <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
