import {
  canonicalEmail,
  commandForProposal,
  MAX_MAILBOXES_PER_USER,
  Rule as RuleSchema,
  Settings,
  type CommandPayload,
  type EventAction,
  type NewMailbox,
  type SettingsPatch,
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

/** Finds the user's mailbox for a Gmail address (Gmail dots and +tags ignored). */
export async function findMailboxByEmail(
  uid: string,
  email: string,
): Promise<DocumentReference | null> {
  const direct = mailboxesCol(uid).doc(mailboxIdFor(email));
  if ((await direct.get()).exists) return direct;
  const all = await mailboxesCol(uid).get();
  const want = canonicalEmail(email);
  const hit = all.docs.find((d) => canonicalEmail(String(d.get('email') ?? '')) === want);
  return hit?.ref ?? null;
}

// ---------------------------------------------------------------------------
// Changes made by the signed-in user in the dashboard apply directly (the user is the approver).
// Changes from MCP arrive as proposals and wait for approval.
// ---------------------------------------------------------------------------

export async function upsertRule(mailbox: DocumentReference, rule: Rule, by: string) {
  const parsed = RuleSchema.parse(rule);
  const id = ruleIdFor(parsed.label);
  await mailbox
    .collection('rules')
    .doc(id)
    .set({ ...parsed, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
  return { id, rule: parsed };
}

export async function updateSettings(
  mailbox: DocumentReference,
  patch: SettingsPatch,
): Promise<Settings> {
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(mailbox);
    const next = Settings.parse({ ...(snap.get('settings') ?? {}), ...patch });
    tx.update(mailbox, { settings: next, settingsUpdatedAt: FieldValue.serverTimestamp() });
    return next;
  });
}

export async function updateMailboxName(mailbox: DocumentReference, displayName: string) {
  await mailbox.update({ displayName: displayName.trim().slice(0, 60) });
}

/**
 * Queues work for the engine. Starting a production pass is refused unless the mailbox's own
 * settings allow production (automation on, dry run off).
 */
export async function queueCommand(
  mailbox: DocumentReference,
  payload: CommandPayload,
  source: 'web' | 'proposal',
  proposalId?: string,
): Promise<string> {
  if (payload.kind === 'run.start' && payload.mode === 'prod') {
    const s = Settings.parse((await mailbox.get()).get('settings') ?? {});
    if (!s.automationEnabled || s.dryRun) {
      throw new HttpError(
        400,
        'Production is off for this mailbox. Turn on automation and turn off dry run in Settings first.',
      );
    }
  }
  const ref = await mailbox.collection('commands').add({
    payload,
    source,
    ...(proposalId ? { proposalId } : {}),
    status: 'queued',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function listCommands(mailbox: DocumentReference, limit = 30) {
  const snap = await mailbox.collection('commands').orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      payload: x.payload as CommandPayload,
      source: String(x.source ?? ''),
      status: String(x.status),
      result: (x.result as { ok: boolean; message: string } | undefined) ?? null,
      createdAt: iso(x.createdAt),
      completedAt: iso(x.completedAt),
    };
  });
}

/** Approves a pending proposal: rule changes apply at once, Gmail changes become commands. */
export async function approveProposal(mailbox: DocumentReference, id: string, by: string) {
  const ref = mailbox.collection('proposals').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Proposal not found');
  if (snap.get('status') !== 'pending')
    throw new HttpError(409, 'This proposal was already decided');
  const payload = snap.get('payload') as ProposalPayload;

  if (payload.kind === 'rule.upsert') {
    await upsertRule(mailbox, payload.rule, `proposal:${id}`);
    await ref.update({ status: 'applied', decidedAt: FieldValue.serverTimestamp(), decidedBy: by });
    return { status: 'applied' as const };
  }
  const command = commandForProposal(payload);
  if (!command) throw new HttpError(400, 'Nothing to apply');
  const commandId = await queueCommand(mailbox, command, 'proposal', id);
  await ref.update({
    status: 'approved',
    commandId,
    decidedAt: FieldValue.serverTimestamp(),
    decidedBy: by,
  });
  return { status: 'approved' as const, commandId };
}

export async function rejectProposal(mailbox: DocumentReference, id: string, by: string) {
  const ref = mailbox.collection('proposals').doc(id);
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'Proposal not found');
    if (snap.get('status') !== 'pending') throw new HttpError(409, 'Already decided');
    tx.update(ref, { status: 'rejected', decidedAt: FieldValue.serverTimestamp(), decidedBy: by });
  });
  return { status: 'rejected' as const };
}

export type EventView = {
  id: string;
  messageId: string;
  threadId: string;
  at: string;
  runId: string;
  mode: 'dry' | 'prod';
  action: EventAction;
  preview: boolean;
  label: string;
  reason: string;
  ageDays: number;
  senderDomain: string;
  subject?: string;
};

export async function listEvents(
  mailbox: DocumentReference,
  opts: { action?: EventAction; runId?: string; before?: string; limit?: number } = {},
): Promise<EventView[]> {
  let q = mailbox.collection('events').orderBy('at', 'desc');
  if (opts.action)
    q = mailbox.collection('events').where('action', '==', opts.action).orderBy('at', 'desc');
  if (opts.runId)
    q = mailbox.collection('events').where('runId', '==', opts.runId).orderBy('at', 'desc');
  if (opts.before) q = q.startAfter(opts.before);
  const snap = await q.limit(Math.min(200, opts.limit ?? 100)).get();
  return snap.docs.map((d) => {
    const { expireAt: _e, receivedAt: _r, ...x } = d.data();
    return { id: d.id, ...(x as Omit<EventView, 'id'>) };
  });
}

/** Labels and filters as last reported by the engine. */
export async function getMirror(mailbox: DocumentReference, kind: 'labels' | 'filters') {
  const snap = await mailbox.collection('mirror').doc(kind).get();
  return {
    items: (snap.get(kind) as unknown[] | undefined) ?? [],
    updatedAt: iso(snap.get('updatedAt')),
  };
}
