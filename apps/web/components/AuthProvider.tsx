'use client';

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clientAuth, isFirebaseConfigured } from '../lib/firebase-client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type AuthState = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    const auth = clientAuth();
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async () => {
    const auth = clientAuth();
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  }, []);

  const signOut = useCallback(async () => {
    const auth = clientAuth();
    if (auth) await firebaseSignOut(auth);
  }, []);

  const api = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!user) throw new ApiError(401, 'Sign in required');
      const token = await user.getIdToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
          authorization: `Bearer ${token}`,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
      return body as T;
    },
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, configured: isFirebaseConfigured, signIn, signOut, api }),
    [user, loading, signIn, signOut, api],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
