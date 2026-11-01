'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';

export default function SignInPage() {
  const { user, loading, configured, signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold tracking-tight">MailOps</h1>
        <p className="mt-2 text-sm text-slate-500">
          Rules-based Gmail automation. Your Gmail stays in your account: this site only uses basic
          Google sign-in.
        </p>
        {!configured ? (
          <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            This deployment has no Firebase configuration yet. See{' '}
            <code>apps/web/.env.example</code>.
          </p>
        ) : (
          <button
            disabled={loading}
            onClick={() => signIn().catch((e) => setError(String(e?.message ?? e)))}
            className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            Sign in with Google
          </button>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
