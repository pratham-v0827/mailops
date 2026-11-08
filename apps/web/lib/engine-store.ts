import {
  canonicalEmail,
  ConnectorToken,
  Settings,
  type CommandPayload,
  type CommandResult,
  type EngineEvent,
  type EngineHeartbeat,
  type EngineRunReport,
  type MirroredFilter,
  type MirroredLabel,
  type Rule,
} from '@mailops/schema';
import { ENGINE_LATEST_VERSION } from './version';
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
      ...(hb.state ? { state: hb.state } : {}),
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
  requireConnected(ctx);
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

/**
 * Configuration the engine pulls on every sync: settings and rules for its mailbox. Each rule
 * carries `changedAt` so the engine can preview recently changed rules before acting on them.
 */
export async function engineConfig(ctx: EngineContext) {
  const [snap, rules, queued] = await Promise.all([
    ctx.mailbox.get(),
    ctx.mailbox.collection('rules').orderBy('label').get(),
    ctx.mailbox.collection('commands').where('status', 'in', ['queued', 'sent']).count().get(),
  ]);
  return {
    mailboxId: ctx.mailbox.id,
    email: ctx.email,
    settings: Settings.parse(snap.get('settings') ?? {}),
    rules: rules.docs.map((d) => {
      const { updatedAt, updatedBy: _b, ...rule } = d.data();
      return { ...(rule as Rule), changedAt: iso(updatedAt) };
    }),
    pendingCommands: queued.data().count,
    latestEngineVersion: ENGINE_LATEST_VERSION,
    serverTime: new Date().toISOString(),
  };
}

/** Commands not acknowledged within this time are handed out again (all kinds are idempotent). */
const COMMAND_RESEND_MS = 30 * 60 * 1000;

/** Hands the engine its queued commands (oldest first) and marks them sent. */
export async function takeCommands(ctx: EngineContext) {
  requireConnected(ctx);
  const col = ctx.mailbox.collection('commands');
  const [queued, sent] = await Promise.all([
    col.where('status', '==', 'queued').orderBy('createdAt').limit(20).get(),
    col.where('status', '==', 'sent').orderBy('createdAt').limit(20).get(),
  ]);
  const stale = sent.docs.filter(
    (d) =>
      Date.now() - ((d.get('sentAt') as { toMillis?: () => number })?.toMillis?.() ?? 0) >
      COMMAND_RESEND_MS,
  );
  const docs = [...queued.docs, ...stale].slice(0, 20);
  if (docs.length) {
    const batch = adminDb().batch();
    for (const d of docs)
      batch.update(d.ref, { status: 'sent', sentAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  return {
    commands: docs.map((d) => ({ id: d.id, payload: d.get('payload') as CommandPayload })),
  };
}

/** The engine reports a command's result; a linked proposal is marked applied or failed. */
export async function completeCommand(ctx: EngineContext, id: string, result: CommandResult) {
  requireConnected(ctx);
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) throw new HttpError(404, 'Command not found');
  const ref = ctx.mailbox.collection('commands').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Command not found');
  const batch = adminDb().batch();
  batch.update(ref, {
    status: result.ok ? 'done' : 'failed',
    result,
    completedAt: FieldValue.serverTimestamp(),
  });
  const proposalId = snap.get('proposalId') as string | undefined;
  if (proposalId) {
    batch.update(ctx.mailbox.collection('proposals').doc(proposalId), {
      status: result.ok ? 'applied' : 'failed',
      result,
    });
  }
  await batch.commit();
  return { ok: true };
}

function requireConnected(ctx: EngineContext) {
  if (!ctx.connected) {
    throw new HttpError(403, 'Mailbox not verified yet; the engine must send a heartbeat first');
  }
}

/**
 * Stores audit events. Subjects are dropped unless the mailbox opted in. Each event carries
 * `expireAt` (now + the mailbox's retention period) and expired events are pruned here about once
 * a day, which works on Firebase's free plan (TTL policies need billing). Ids are deterministic,
 * so a re-sent batch doesn't create duplicates.
 */
export async function recordEvents(ctx: EngineContext, events: EngineEvent[]) {
  requireConnected(ctx);
  const settings = Settings.parse((await ctx.mailbox.get()).get('settings') ?? {});
  const ttl = settings.retentionDays * 86_400_000;
  const col = ctx.mailbox.collection('events');
  const batch = adminDb().batch();
  for (const e of events) {
    const { subject, ...rest } = e;
    batch.set(col.doc(`${e.runId}_${e.messageId}_${e.action}`), {
      ...rest,
      ...(settings.storeSubjects && subject ? { subject } : {}),
      expireAt: new Date(new Date(e.at).getTime() + ttl),
    });
  }
  await batch.commit();
  const pruned = await pruneExpiredEvents(ctx.mailbox);
  return { ok: true, stored: events.length, pruned };
}

const PRUNE_EVERY_MS = 20 * 3600 * 1000;

/** Deletes up to 1,000 expired events, at most once every 20 hours per mailbox. */
export async function pruneExpiredEvents(mailbox: DocumentReference): Promise<number> {
  const snap = await mailbox.get();
  const last =
    (snap.get('eventsPrunedAt') as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - last < PRUNE_EVERY_MS) return 0;
  await mailbox.update({ eventsPrunedAt: FieldValue.serverTimestamp() });
  let total = 0;
  for (let round = 0; round < 2; round++) {
    const expired = await mailbox
      .collection('events')
      .where('expireAt', '<', new Date())
      .limit(500)
      .get();
    if (expired.empty) break;
    const batch = adminDb().batch();
    expired.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += expired.size;
  }
  return total;
}

export async function mirrorLabels(ctx: EngineContext, labels: MirroredLabel[]) {
  requireConnected(ctx);
  await ctx.mailbox
    .collection('mirror')
    .doc('labels')
    .set({ labels, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true, labels: labels.length };
}

/** Merges filter entries (or replaces the list when `complete`), keeping earlier health data. */
export async function mirrorFilters(
  ctx: EngineContext,
  filters: MirroredFilter[],
  complete: boolean,
) {
  requireConnected(ctx);
  const ref = ctx.mailbox.collection('mirror').doc('filters');
  await adminDb().runTransaction(async (tx) => {
    const prev = ((await tx.get(ref)).get('filters') as MirroredFilter[] | undefined) ?? [];
    const byId = new Map(prev.map((f) => [f.id, f]));
    const next = new Map(complete ? [] : byId);
    for (const f of filters) next.set(f.id, { ...f, health: f.health ?? byId.get(f.id)?.health });
    tx.set(ref, {
      filters: [...next.values()].map((f) => JSON.parse(JSON.stringify(f))),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, filters: filters.length };
}

export type RunView = EngineRunReport & { receivedAt: string | null };

export async function listRuns(mailbox: DocumentReference, limit = 20): Promise<RunView[]> {
  const snap = await mailbox.collection('runs').orderBy('endedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const { receivedAt, ...run } = d.data();
    return { ...(run as EngineRunReport), receivedAt: iso(receivedAt) };
  });
}
