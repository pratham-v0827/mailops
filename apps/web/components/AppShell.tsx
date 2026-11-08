'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { MailboxProvider, mailboxLabel, useMailboxes } from './MailboxProvider';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/rules', label: 'Rules' },
];

/** Signed-in layout: header with navigation and mailbox switcher; redirects to sign-in when signed out. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }
  return (
    <MailboxProvider>
      <Shell>{children}</Shell>
    </MailboxProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuth();
  const { email, mailboxes, selected, select } = useMailboxes();
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            MailOps
          </Link>
          <nav className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-1.5 ${
                  pathname === n.href
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          {mailboxes.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Mailbox</span>
              <select
                value={selected?.id ?? ''}
                onChange={(e) => select(e.target.value)}
                className="max-w-[16rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
              >
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {mailboxLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 md:inline">{email}</span>
            <button
              onClick={() => signOut()}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

export function Card({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'good' | 'warn';
}) {
  const ring =
    tone === 'good'
      ? 'border-emerald-300 dark:border-emerald-800'
      : tone === 'warn'
        ? 'border-amber-300 dark:border-amber-800'
        : 'border-slate-200 dark:border-slate-800';
  return (
    <section className={`rounded-xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${ring}`}>
      <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ErrorNote({ status, message }: { status?: number; message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      {status === 403
        ? 'This MailOps instance is invite-only. Ask the owner to add your email.'
        : message}
    </div>
  );
}
