import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

/** Browser-only Firebase Auth instance, or null when the deployment has no Firebase config. */
export function clientAuth(): Auth | null {
  if (!isFirebaseConfigured || typeof window === 'undefined') return null;
  return getAuth(getApps().length ? getApp() : initializeApp(config));
}
