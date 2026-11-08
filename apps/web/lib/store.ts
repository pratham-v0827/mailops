import {
  MAX_MAILBOXES_PER_USER,
  Settings,
  type NewMailbox,
  type ProposalPayload,
  type Rule,
} from '@mailops/schema';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import type { SessionUser } from './auth';
import { adminDb } from './firebase-admin';
import { HttpError } from './http';
import { mailboxIdFor, ruleIdFor } from './ids';

const userRef = (uid: string) => adminDb().collection('users').doc(uid);
const mailboxesCol = (uid: string) => userRef(uid).collection('mailboxes');

const iso = (v: unknown): string | null =>
  (v as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null;

/** Creates the user profile on first sign-in. */
export async function ensureUser(user: SessionUser): Promise<void> {
  const ref = userRef(user.uid);
  if (!(await ref.get()).exists) {
    await ref.set({ email: user.email, createdAt: FieldValue.serverTimestamp() });
  }
}

export type MailboxSummary = {
  id: string;
  email: string;
  displayName: string;
  connected: boolean;
  hasConnector: boolean;
  settings: Settings;
  ruleCount: number;
  pendingProposals: number;
  engine: {
    lastSeenAt: string | null;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastRunMode: 'dry' | 'prod' | null;
    reportedMode: 'dry' | 'prod' | null;
    reportedAutomationEnabled: boolean | null;
    engineVersion: string | null;
  } | null;
};

async function summarise(ref: DocumentReference): Promise<MailboxSummary> {
  const [snap, rules, pending, hb] = await Promise.all([
    ref.get(),
    ref.collection('rules').count().get(),
    ref.collection('proposals').where('status', '==', 'pending').count().get(),
    ref.collection('heartbeat').doc('engine').get(),
  ]);
  const d = snap.data() ?? {};
  const h = hb.data();
  return {
    id: ref.id,
    email: String(d.email ?? ''),
    displayName: String(d.displayName ?? ''),
    connected: Boolean(d.connected),
    hasConnector: Boolean(d.connectorTokenHash),
    settings: Settings.parse(d.settings ?? {}),
    ruleCount: rules.data().count,
    pendingProposals: pending.data().count,
    engine: h
      ? {
          lastSeenAt: iso(h.lastSeenAt),
          lastRunAt: iso(h.lastRunAt),
          lastRunStatus: (h.lastRunStatus as string) ?? null,
          lastRunMode: (h.lastRunMode as 'dry' | 'prod') ?? null,
          reportedMode: (h.reportedMode as 'dry' | 'prod') ?? null,
          reportedAutomationEnabled:
            typeof h.reportedAutomationEnabled === 'boolean' ? h.reportedAutomationEnabled : null,
          engineVersion: (h.engineVersion as string) ?? null,
        }
      : null,
  };
}

export async function listMailboxes(uid: string): Promise<MailboxSummary[]> {
  const snap = await mailboxesCol(uid).orderBy('createdAt').get();
  return Promise.all(snap.docs.map((d) => summarise(d.ref)));
}

/** Adds a Gmail address to the user's account with safe default settings. */
export async function addMailbox(uid: string, input: NewMailbox): Promise<MailboxSummary> {
  const col = mailboxesCol(uid);
  const ref = col.doc(mailboxIdFor(input.email));
  await adminDb().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new HttpError(409, `${input.email} is already added`);
    const count = (await tx.get(col.count())).data().count;
    if (count >= MAX_MAILBOXES_PER_USER) {
      throw new HttpError(400, `At most ${MAX_MAILBOXES_PER_USER} mailboxes per account`);
    }
    tx.set(ref, {
      email: input.email,
      displayName: input.displayName,
      connected: false,
      settings: Settings.parse({}),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return summarise(ref);
}

/** Returns the mailbox document, or 404 if it isn't one of this user's mailboxes. */
export async function requireMailbox(uid: string, mailboxId: string): Promise<DocumentReference> {
  if (!/^mb_[0-9a-f]{20}$/.test(mailboxId)) throw new HttpError(404, 'Mailbox not found');
  const ref = mailboxesCol(uid).doc(mailboxId);
  if (!(await ref.get()).exists) throw new HttpError(404, 'Mailbox not found');
  return ref;
}

export async function listRules(mailbox: DocumentReference): Promise<(Rule & { id: string })[]> {
  const snap = await mailbox.collection('rules').orderBy('label').get();
  return snap.docs.map((d) => {
    const { updatedAt: _u, updatedBy: _b, ...rule } = d.data();
    return { id: d.id, ...(rule as Rule) };
  });
}

/** One-time seed of a mailbox's rules (later changes go through proposals). */
export async function importRules(mailbox: DocumentReference, rules: Rule[]): Promise<number> {
  if ((await mailbox.collection('rules').count().get()).data().count > 0) {
    throw new HttpError(409, 'This mailbox already has rules; change them through proposals');
  }
  const db = adminDb();
  const col = mailbox.collection('rules');
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

export async function listProposals(mailbox: DocumentReference, status = 'pending') {
  const snap = await mailbox
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
      createdAt: iso(data.createdAt),
    };
  });
}

export async function createProposal(
  mailbox: DocumentReference,
  payload: ProposalPayload,
  source: 'web' | 'mcp',
  reason: string,
): Promise<string> {
  const ref = await mailbox.collection('proposals').add({
    payload,
    source,
    reason,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}
