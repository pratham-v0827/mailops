import { Settings, type ProposalPayload, type Rule } from '@mailops/schema';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './http';
import { ruleIdFor } from './ids';
import type { SessionUser } from './auth';

const userRef = (db: Firestore, uid: string) => db.collection('users').doc(uid);

/** Creates the profile with safe default settings on first sign-in; returns current settings. */
export async function ensureUser(user: SessionUser): Promise<Settings> {
  const db = adminDb();
  const ref = userRef(db, user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    const settings = Settings.parse({});
    await ref.set({
      email: user.email,
      createdAt: FieldValue.serverTimestamp(),
      settings,
    });
    return settings;
  }
  return Settings.parse(snap.get('settings') ?? {});
}

export async function listRules(uid: string): Promise<(Rule & { id: string })[]> {
  const snap = await userRef(adminDb(), uid).collection('rules').orderBy('label').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Rule) }));
}

export async function countRules(uid: string): Promise<number> {
  const agg = await userRef(adminDb(), uid).collection('rules').count().get();
  return agg.data().count;
}

/** One-time seed of rules for a user who has none yet (later changes go through proposals). */
export async function importRules(uid: string, rules: Rule[]): Promise<number> {
  if ((await countRules(uid)) > 0) {
    throw new HttpError(409, 'Rules already exist; change them through proposals instead');
  }
  const db = adminDb();
  const col = userRef(db, uid).collection('rules');
  for (let i = 0; i < rules.length; i += 400) {
    const batch = db.batch();
    for (const r of rules.slice(i, i + 400)) {
      batch.set(col.doc(ruleIdFor(r.label)), {
        ...r,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'import',
      });
    }
    await batch.commit();
  }
  return rules.length;
}

export async function listProposals(uid: string, status = 'pending') {
  const snap = await userRef(adminDb(), uid)
    .collection('proposals')
    .where('status', '==', status)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      payload: data.payload as ProposalPayload,
      source: data.source as string,
      status: data.status as string,
      reason: (data.reason as string) ?? '',
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    };
  });
}

export async function countPendingProposals(uid: string): Promise<number> {
  const agg = await userRef(adminDb(), uid)
    .collection('proposals')
    .where('status', '==', 'pending')
    .count()
    .get();
  return agg.data().count;
}

export async function createProposal(
  uid: string,
  payload: ProposalPayload,
  source: 'web' | 'mcp',
  reason: string,
): Promise<string> {
  const ref = await userRef(adminDb(), uid).collection('proposals').add({
    payload,
    source,
    reason,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function getHeartbeat(uid: string) {
  const snap = await userRef(adminDb(), uid).collection('heartbeat').doc('engine').get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    lastSeenAt: d.lastSeenAt?.toDate?.().toISOString() ?? null,
    lastRunAt: d.lastRunAt?.toDate?.().toISOString() ?? null,
    lastRunStatus: (d.lastRunStatus as string) ?? null,
    engineVersion: (d.engineVersion as string) ?? null,
  };
}
