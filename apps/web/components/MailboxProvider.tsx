'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { MailboxView, MeResponse } from '../lib/api-types';
import { ApiError, useAuth } from './AuthProvider';

const STORAGE_KEY = 'mailops.selectedMailbox';

type MailboxState = {
  email: string;
  mailboxes: MailboxView[];
  selected: MailboxView | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  error: ApiError | null;
  loading: boolean;
};

const MailboxContext = createContext<MailboxState | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the choice just isn't remembered.
  }
}

/** Loads the signed-in user's mailboxes and tracks which one the dashboard is showing. */
export function MailboxProvider({ children }: { children: React.ReactNode }) {
  const { api } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api<MeResponse>('/api/web/me');
      setMe(res);
      setError(null);
      setSelectedId((current) => {
        const wanted = current ?? readStored();
        return res.mailboxes.some((m) => m.id === wanted) ? wanted : (res.mailboxes[0]?.id ?? null);
      });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    writeStored(id);
  }, []);

  const value = useMemo<MailboxState>(
    () => ({
      email: me?.email ?? '',
      mailboxes: me?.mailboxes ?? [],
      selected: me?.mailboxes.find((m) => m.id === selectedId) ?? null,
      select,
      reload,
      error,
      loading: !me && !error,
    }),
    [me, selectedId, select, reload, error],
  );

  return <MailboxContext.Provider value={value}>{children}</MailboxContext.Provider>;
}

export function useMailboxes(): MailboxState {
  const ctx = useContext(MailboxContext);
  if (!ctx) throw new Error('useMailboxes must be used inside <MailboxProvider>');
  return ctx;
}

export function mailboxLabel(m: Pick<MailboxView, 'email' | 'displayName'>): string {
  return m.displayName ? `${m.displayName} · ${m.email}` : m.email;
}
