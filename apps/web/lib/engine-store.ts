import {
  canonicalEmail,
  ConnectorToken,
  Settings,
  type EngineHeartbeat,
  type EngineRunReport,
  type Rule,
} from '@mailops/schema';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './http';
import { generateConnectorToken, hashToken, sameHash } from './tokens';

const tokensCol = () => adminDb().collection('connectorTokens');

const iso = (v: unknown): string | null =>
  (v as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null;

/**
 * Issues a new connector token for a mailbox and revokes the previous one. Returns the plaintext
 * token; only its hash is stored.
 */
export async function issueConnectorToken(
  uid: string,
  mailbox: DocumentReference,
): Promise<string> {
  const token = generateConnectorToken();
  const hash = hashToken(token);
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(mailbox);
    const previous = snap.get('connectorTokenHash') as string | undefined;
    if (previous)
      tx.set(
        tokensCol().doc(previous),
        { revoked: true, revokedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    tx.set(tokensCol().doc(hash), {
      uid,
      mailboxId: mailbox.id,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
      lastUsedAt: null,
    });
    tx.update(mailbox, {
      connectorTokenHash: hash,
      connectorIssuedAt: FieldValue.serverTimestamp(),
    });
  });
  return token;
}

/** Revokes the mailbox's connector token; the engine can no longer call the API. */
export async function revokeConnectorToken(mailbox: DocumentReference): Promise<void> {
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(mailbox);
    const hash = snap.get('connectorTokenHash') as string | undefined;
    if (!hash) return;
    tx.set(
      tokensCol().doc(hash),
      { revoked: true, revokedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.update(mailbox, { connectorTokenHash: FieldValue.delete(), connected: false });
  });
}

export type EngineContext = {
  uid: string;
  mailbox: DocumentReference;
  email: string;
  connected: boolean;
};

/** Authenticates an engine request by its connector token (Authorization: Bearer mops_…). */
export async function requireEngine(request: Request): Promise<EngineContext> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!ConnectorToken.safeParse(token).success)
    throw new HttpError(401, 'Missing or malformed connector token');

  const hash = hashToken(token);
  const tokenSnap = await tokensCol().doc(hash).get();
  if (!tokenSnap.exists || tokenSnap.get('revoked'))
    throw new HttpError(401, 'Connector token is not valid');

  const uid = String(tokenSnap.get('uid'));
  const mailbox = adminDb()
    .collection('users')
    .doc(uid)
    .collection('mailboxes')
    .doc(String(tokenSnap.get('mailboxId')));
  const mbSnap = await mailbox.get();
  if (!mbSnap.exists || !sameHash(String(mbSnap.get('connectorTokenHash') ?? ''), hash)) {
    throw new HttpError(401, 'Connector token is not valid');
  }

  // Record use at most once an hour to keep writes low.
  const last =
    (tokenSnap.get('lastUsedAt') as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
  if (Date.now() - last > 3_600_000) {
    await tokenSnap.ref.update({ lastUsedAt: FieldValue.serverTimestamp() });
  }
  return {
    uid,
    mailbox,
    email: String(mbSnap.get('email') ?? ''),
    connected: Boolean(mbSnap.get('connected')),
  };
}

/**
 * Records a heartbeat. The engine reports which Gmail account it runs in; it must be the mailbox's
 * address, which is how MailOps confirms the user really controls that account.
 */
export async function recordHeartbeat(ctx: EngineContext, hb: EngineHeartbeat) {
  if (canonicalEmail(hb.gmailAddress) !== canonicalEmail(ctx.email)) {
    throw new HttpError(
      403,
      `This token is for ${ctx.email}, but the engine runs in ${hb.gmailAddress}. Create a token for that mailbox instead.`,
    );
  }
  const batch = adminDb().batch();
  batch.update(ctx.mailbox, { connected: true });
  batch.set(
    ctx.mailbox.collection('heartbeat').doc('engine'),
    {
      lastSeenAt: FieldValue.serverTimestamp(),
      engineVersion: hb.engineVersion,
      ...(hb.mode ? { reportedMode: hb.mode } : {}),
      ...(hb.automationEnabled !== undefined
        ? { reportedAutomationEnabled: hb.automationEnabled }
        : {}),
    },
    { merge: true },
  );
  await batch.commit();
  return { ok: true, mailboxId: ctx.mailbox.id };
}

/**
 * Stores one run report, updates the heartbeat and the per-day counters. Idempotent: re-sending
 * the same runId updates the run but doesn't count it twice.
 */
export async function recordRun(ctx: EngineContext, run: EngineRunReport) {
  if (!ctx.connected) {
    throw new HttpError(403, 'Mailbox not verified yet; the engine must send a heartbeat first');
  }
  const day = run.endedAt.slice(0, 10);
  const runRef = ctx.mailbox.collection('runs').doc(run.runId);
  const duplicate = await adminDb().runTransaction(async (tx) => {
    const existed = (await tx.get(runRef)).exists;
    tx.set(runRef, { ...run, receivedAt: FieldValue.serverTimestamp() });
    tx.set(
      ctx.mailbox.collection('heartbeat').doc('engine'),
      {
        lastSeenAt: FieldValue.serverTimestamp(),
        lastRunAt: new Date(run.endedAt),
        lastRunStatus: run.status,
        lastRunMode: run.mode,
        engineVersion: run.engineVersion,
      },
      { merge: true },
    );
    if (!existed) {
      tx.set(
        ctx.mailbox.collection('stats').doc(day),
        {
          [run.mode]: {
            runs: FieldValue.increment(1),
            scanned: FieldValue.increment(run.scanned),
            archived: FieldValue.increment(run.archived),
            trashed: FieldValue.increment(run.trashed),
            protected: FieldValue.increment(run.protected),
            errors: FieldValue.increment(run.errors),
          },
        },
        { merge: true },
      );
    }
    return existed;
  });
  return { ok: true, duplicate };
}

/** Configuration the engine pulls: settings and rules for its mailbox. */
export async function engineConfig(ctx: EngineContext) {
  const [snap, rules] = await Promise.all([
    ctx.mailbox.get(),
    ctx.mailbox.collection('rules').orderBy('label').get(),
  ]);
  return {
    mailboxId: ctx.mailbox.id,
    email: ctx.email,
    settings: Settings.parse(snap.get('settings') ?? {}),
    rules: rules.docs.map((d) => {
      const { updatedAt: _u, updatedBy: _b, ...rule } = d.data();
      return rule as Rule;
    }),
    serverTime: new Date().toISOString(),
  };
}

export type RunView = EngineRunReport & { receivedAt: string | null };

export async function listRuns(mailbox: DocumentReference, limit = 20): Promise<RunView[]> {
  const snap = await mailbox.collection('runs').orderBy('endedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const { receivedAt, ...run } = d.data();
    return { ...(run as EngineRunReport), receivedAt: iso(receivedAt) };
  });
}
