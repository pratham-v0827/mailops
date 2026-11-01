import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpError } from './http';

// Server-only. Never import this file from a client component.
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new HttpError(503, 'Server is not configured (FIREBASE_SERVICE_ACCOUNT_JSON)');
  let account: { project_id?: string; client_email?: string; private_key?: string };
  try {
    account = JSON.parse(raw);
  } catch {
    throw new HttpError(503, 'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  return initializeApp({
    credential: cert({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    }),
  });
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
