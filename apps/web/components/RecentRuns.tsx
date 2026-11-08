'use client';

import { useEffect, useState } from 'react';
import type { RunsResponse, RunView } from '../lib/api-types';
import { useAuth } from './AuthProvider';

const STATUS_TONE: Record<string, string> = {
  SUCCESS: 'text-emerald-700 dark:text-emerald-400',
  'PARTIAL SUCCESS': 'text-amber-700 dark:text-amber-400',
  CONTINUING: 'text-slate-600 dark:text-slate-300',
  PAUSED: 'text-amber-700 dark:text-amber-400',
  FAILED: 'text-red-700 dark:text-red-400',
};

/** The mailbox's latest engine runs (counts only). */
export function RecentRuns({ mailboxId }: { mailboxId: string }) {
  const { api } = useAuth();
  const [runs, setRuns] = useState<RunView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<RunsResponse>(`/api/web/mailboxes/${mailboxId}/runs`).then(
      (r) => setRuns(r.runs),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [api, mailboxId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!runs) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!runs.length) {
    return <p className="text-sm text-slate-500">No runs reported yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-3">Finished</th>
            <th className="py-2 pr-3">Mode</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3 text-right">Scanned</th>
            <th className="py-2 pr-3 text-right">Archived</th>
            <th className="py-2 pr-3 text-right">To Trash</th>
            <th className="py-2 pr-3 text-right">Protected</th>
            <th className="py-2 text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-2 pr-3 whitespace-nowrap">
                {new Date(r.endedAt).toLocaleString()}
              </td>
              <td className="py-2 pr-3">{r.mode === 'dry' ? 'Dry run' : 'Production'}</td>
              <td className={`py-2 pr-3 ${STATUS_TONE[r.status] ?? ''}`}>{r.status}</td>
              <td className="py-2 pr-3 text-right">{r.scanned}</td>
              <td className="py-2 pr-3 text-right">{r.archived}</td>
              <td className="py-2 pr-3 text-right">{r.trashed}</td>
              <td className="py-2 pr-3 text-right">{r.protected}</td>
              <td className="py-2 text-right">{r.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
