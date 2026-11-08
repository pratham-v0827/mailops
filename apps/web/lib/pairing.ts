import { randomBytes, randomInt } from 'node:crypto';
import { formatPairCode, PAIR_CODE_ALPHABET } from '@mailops/schema';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { issueConnectorToken } from './engine-store';
import { adminDb } from './firebase-admin';
import { HttpError } from './http';
import { addMailbox, findMailboxByEmail } from './store';
import { hashToken } from './tokens';

/**
 * Pairing links a freshly installed engine to a mailbox without copying tokens around
 * (like signing in to a TV app):
 *   1. The engine proves its Gmail address with a Google identity token and gets a device code
 *      (kept secret by the engine) plus a short user code (shown to the user).
 *   2. The signed-in user enters or opens the user code on the dashboard and approves it.
 *   3. The engine polls with its device code and receives its connector token, once.
 */
const PAIR_TTL_MS = 15 * 60 * 1000;
const pairings = () => adminDb().collection('pairings');

function newUserCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += PAIR_CODE_ALPHABET[randomInt(PAIR_CODE_ALPHABET.length)];
  return s;
}

/** Removes a few expired pairings (they hold no secrets once delivered or expired). */
async function pruneExpiredPairings() {
  const old = await pairings().where('expireAt', '<', Timestamp.now()).limit(20).get();
  if (old.empty) return;
  const batch = adminDb().batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function startPairing(email: string, engineVersion: string) {
  await pruneExpiredPairings();
  const deviceCode = randomBytes(32).toString('base64url');
  const userCode = newUserCode();
  const expireAt = Timestamp.fromMillis(Date.now() + PAIR_TTL_MS);
  await pairings().doc(hashToken(deviceCode)).set({
    userCode,
    email,
    engineVersion,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expireAt,
  });
  return {
    deviceCode,
    userCode: formatPairCode(userCode),
    email,
    expiresInSeconds: PAIR_TTL_MS / 1000,
    intervalSeconds: 5,
  };
}

type PollResult =
  | { status: 'pending' }
  | { status: 'approved'; token: string; mailboxId: string; email: string };

/** Called by the engine; returns the connector token exactly once after approval. */
export async function pollPairing(deviceCode: string): Promise<PollResult> {
  const ref = pairings().doc(hashToken(deviceCode));
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'Unknown pairing; run setup again');
    const d = snap.data()!;
    if ((d.expireAt as Timestamp).toMillis() < Date.now() || d.status === 'delivered') {
      throw new HttpError(410, 'This pairing code has expired; run setup again');
    }
    if (d.status !== 'approved') return { status: 'pending' as const };
    tx.update(ref, { status: 'delivered', token: FieldValue.delete() });
    return {
      status: 'approved' as const,
      token: String(d.token),
      mailboxId: String(d.mailboxId),
      email: String(d.email),
    };
  });
}

async function findPending(userCode: string) {
  const snap = await pairings()
    .where('userCode', '==', userCode)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc || (doc.get('expireAt') as Timestamp).toMillis() < Date.now()) {
    throw new HttpError(404, 'Code not found or expired. Run setup in Apps Script again.');
  }
  return doc;
}

/** What the dashboard shows before the user approves a code. */
export async function describePairing(uid: string, userCode: string) {
  const doc = await findPending(userCode);
  const email = String(doc.get('email'));
  const existing = await findMailboxByEmail(uid, email);
  return {
    email,
    engineVersion: String(doc.get('engineVersion')),
    existingMailboxId: existing?.id ?? null,
    expiresAt: (doc.get('expireAt') as Timestamp).toDate().toISOString(),
  };
}

/**
 * Approves a pairing for the signed-in user: uses (or creates) the mailbox for the verified Gmail
 * address, issues a fresh connector token (revoking any older one) and hands it to the engine.
 */
export async function approvePairing(uid: string, userCode: string, displayName: string) {
  const doc = await findPending(userCode);
  const email = String(doc.get('email'));
  let mailbox = await findMailboxByEmail(uid, email);
  if (!mailbox) {
    const created = await addMailbox(uid, { email, displayName });
    mailbox = adminDb().collection('users').doc(uid).collection('mailboxes').doc(created.id);
  }
  const token = await issueConnectorToken(uid, mailbox);
  // Google verified the address, so the mailbox counts as connected straight away.
  await mailbox.update({ connected: true });
  await doc.ref.update({
    status: 'approved',
    token,
    uid,
    mailboxId: mailbox.id,
    approvedAt: FieldValue.serverTimestamp(),
  });
  return { mailboxId: mailbox.id, email };
}
