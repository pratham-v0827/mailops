import {
  describeProposal,
  EventAction,
  FilterCriteria,
  LabelName,
  Rule,
  type McpScope,
  type ProposalPayload,
} from '@mailops/schema';
import { z } from 'zod';
import { listRuns } from './engine-store';
import { HttpError } from './http';
import type { McpAuth } from './mcp-tokens';
import {
  createProposal,
  findMailboxByEmail,
  getMirror,
  listEvents,
  listMailboxes,
  listProposals,
  listRules,
  requireMailbox,
} from './store';
import { ENGINE_LATEST_VERSION } from './version';

/**
 * A small MCP server (Streamable HTTP transport, stateless, JSON responses). Tools can read a
 * user's mailboxes and *propose* changes. Nothing here approves, deletes, or turns production on:
 * proposals wait on the dashboard's Proposals page for the signed-in person.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `MailOps manages Gmail with lifecycle rules (archive after N days, move to Trash after M days, or keep forever) and Gmail filters. Each Gmail address is a "mailbox"; pass its id or email address as \`mailbox\`.
You can read rules, labels, filters (with health: how many matching messages in the last 30 days carry the label), recent activity and runs.
Changes are proposals: the user approves them on the MailOps dashboard (Proposals page) before anything happens. Prefer previewing with propose_dry_run after rule changes. MailOps never permanently deletes mail; "trash" means Gmail Trash (recoverable for 30 days).`;

const MailboxArg = z
  .string()
  .min(1)
  .describe('Mailbox id (mb_…) or its Gmail address. Use list_mailboxes to see them.');
const Reason = z
  .string()
  .max(1000)
  .default('')
  .describe('Why you suggest this (shown to the user).');

type Tool = {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  input: z.ZodType;
  run: (auth: McpAuth, args: never) => Promise<unknown>;
};

async function mailboxFor(auth: McpAuth, ref: string) {
  if (/^mb_[0-9a-f]{20}$/.test(ref)) return requireMailbox(auth.uid, ref);
  const m = await findMailboxByEmail(auth.uid, ref);
  if (!m) throw new HttpError(404, `No mailbox ${ref}. Use list_mailboxes.`);
  return m;
}

async function propose(auth: McpAuth, mailbox: string, payload: ProposalPayload, reason: string) {
  const ref = await mailboxFor(auth, mailbox);
  const id = await createProposal(ref, payload, 'mcp', reason);
  return {
    proposalId: id,
    status: 'pending',
    summary: describeProposal(payload),
    next: 'Ask the user to approve it on the MailOps dashboard → Proposals.',
  };
}

const tool = <S extends z.ZodType>(t: {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  input: S;
  run: (auth: McpAuth, args: z.infer<S>) => Promise<unknown>;
}): Tool => t as unknown as Tool;

export const TOOLS: Tool[] = [
  tool({
    name: 'list_mailboxes',
    title: 'List mailboxes',
    description: 'Gmail accounts this user manages with MailOps, with engine status and mode.',
    scope: 'read',
    input: z.object({}),
    run: async (auth) =>
      (await listMailboxes(auth.uid)).map((m) => ({
        id: m.id,
        email: m.email,
        name: m.displayName,
        connected: m.connected,
        mode: m.settings.automationEnabled && !m.settings.dryRun ? 'production' : 'dry run',
        rules: m.ruleCount,
        pendingProposals: m.pendingProposals,
        engineVersion: m.engine?.engineVersion ?? null,
        lastSeenAt: m.engine?.lastSeenAt ?? null,
        latestEngineVersion: ENGINE_LATEST_VERSION,
      })),
  }),
  tool({
    name: 'list_rules',
    title: 'List lifecycle rules',
    description:
      'Lifecycle rules of a mailbox (one per Gmail label). Optionally filter by label text.',
    scope: 'read',
    input: z.object({ mailbox: MailboxArg, labelContains: z.string().max(100).optional() }),
    run: async (auth, a) => {
      const rules = await listRules(await mailboxFor(auth, a.mailbox));
      const f = a.labelContains?.toLowerCase();
      return rules
        .filter((r) => !f || r.label.toLowerCase().includes(f))
        .map(({ id: _id, changedBy: _b, ...r }) => r);
    },
  }),
  tool({
    name: 'get_settings',
    title: 'Get mailbox settings',
    description: 'Mode (dry run / production), safety guards, schedule and privacy settings.',
    scope: 'read',
    input: z.object({ mailbox: MailboxArg }),
    run: async (auth, a) => {
      const ref = await mailboxFor(auth, a.mailbox);
      return (await ref.get()).get('settings') ?? {};
    },
  }),
  tool({
    name: 'list_labels',
    title: 'List Gmail labels',
    description: 'User labels with message counts and whether a lifecycle rule covers them.',
    scope: 'read',
    input: z.object({ mailbox: MailboxArg, nameContains: z.string().max(100).optional() }),
    run: async (auth, a) => {
      const ref = await mailboxFor(auth, a.mailbox);
      const [m, rules] = await Promise.all([getMirror(ref, 'labels'), listRules(ref)]);
      const covered = new Set(rules.map((r) => r.label));
      const f = a.nameContains?.toLowerCase();
      return {
        updatedAt: m.updatedAt,
        labels: (m.items as { name: string; type: string; messagesTotal?: number }[])
          .filter((l) => l.type === 'user' && (!f || l.name.toLowerCase().includes(f)))
          .map((l) => ({
            name: l.name,
            messages: l.messagesTotal ?? null,
            hasRule: covered.has(l.name),
          })),
      };
    },
  }),
  tool({
    name: 'list_filters',
    title: 'List Gmail filters',
    description:
      'Gmail filters with health: of the messages matching a filter in the last 30 days, how many carry its label. Low health means mail is slipping past the filter.',
    scope: 'read',
    input: z.object({ mailbox: MailboxArg, unhealthyOnly: z.boolean().default(false) }),
    run: async (auth, a) => {
      const m = await getMirror(await mailboxFor(auth, a.mailbox), 'filters');
      type F = {
        criteria: unknown;
        addLabels: string[];
        removeLabels: string[];
        health?: { matched30d: number; labelled30d: number };
      };
      const list = (m.items as F[]).map((f) => ({
        criteria: f.criteria,
        addLabels: f.addLabels,
        skipsInbox: f.removeLabels.includes('INBOX'),
        health: f.health
          ? {
              ...f.health,
              pct: f.health.matched30d
                ? Math.round((100 * f.health.labelled30d) / f.health.matched30d)
                : null,
            }
          : null,
      }));
      return {
        updatedAt: m.updatedAt,
        filters: a.unhealthyOnly
          ? list.filter((f) => f.health?.pct !== null && f.health !== null && f.health.pct < 70)
          : list,
      };
    },
  }),
  tool({
    name: 'recent_activity',
    title: 'Recent activity',
    description:
      'What MailOps did (or would do in a preview) per message: action, label, sender domain, age. Subjects only if the user opted in.',
    scope: 'read',
    input: z.object({
      mailbox: MailboxArg,
      action: EventAction.optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: async (auth, a) =>
      (
        await listEvents(await mailboxFor(auth, a.mailbox), { action: a.action, limit: a.limit })
      ).map(({ id: _i, threadId: _t, ...e }) => e),
  }),
  tool({
    name: 'recent_runs',
    title: 'Recent runs',
    description:
      'The engine’s latest batches with counts (scanned, archived, trashed, protected, errors).',
    scope: 'read',
    input: z.object({ mailbox: MailboxArg, limit: z.number().int().min(1).max(50).default(10) }),
    run: async (auth, a) => listRuns(await mailboxFor(auth, a.mailbox), a.limit),
  }),
  tool({
    name: 'list_proposals',
    title: 'List proposals',
    description: 'Pending proposals (waiting for the user) or decided ones with their results.',
    scope: 'read',
    input: z.object({
      mailbox: MailboxArg,
      status: z.enum(['pending', 'decided']).default('pending'),
    }),
    run: async (auth, a) =>
      (await listProposals(await mailboxFor(auth, a.mailbox), a.status)).map((p) => ({
        ...p,
        summary: describeProposal(p.payload),
      })),
  }),
  tool({
    name: 'propose_rule',
    title: 'Propose a lifecycle rule',
    description:
      'Propose creating or changing the rule for one Gmail label. archiveAfterDays/trashAfterDays: null = never. neverDelete forbids Trash. The user must approve it; after approval the rule previews for a while before acting.',
    scope: 'propose',
    input: z.object({ mailbox: MailboxArg, rule: Rule, reason: Reason }),
    run: async (auth, a) =>
      propose(auth, a.mailbox, { kind: 'rule.upsert', rule: a.rule }, a.reason),
  }),
  tool({
    name: 'propose_label',
    title: 'Propose a Gmail label',
    description:
      'Propose creating a Gmail label (nested with "/"). Applied by the engine after approval.',
    scope: 'propose',
    input: z.object({ mailbox: MailboxArg, label: LabelName, reason: Reason }),
    run: async (auth, a) =>
      propose(auth, a.mailbox, { kind: 'label.create', label: a.label }, a.reason),
  }),
  tool({
    name: 'propose_filter',
    title: 'Propose a Gmail filter',
    description:
      'Propose a Gmail filter that adds a label to matching mail (optionally skipping the inbox). Criteria use Gmail search syntax.',
    scope: 'propose',
    input: z.object({
      mailbox: MailboxArg,
      criteria: FilterCriteria,
      addLabel: LabelName,
      archive: z.boolean().default(false).describe('Skip the inbox (archive on arrival).'),
      reason: Reason,
    }),
    run: async (auth, a) =>
      propose(
        auth,
        a.mailbox,
        { kind: 'filter.create', criteria: a.criteria, addLabel: a.addLabel, archive: a.archive },
        a.reason,
      ),
  }),
  tool({
    name: 'propose_dry_run',
    title: 'Propose a dry run',
    description:
      'Propose a full dry run (a preview that changes nothing) so the user can check rules on the Activity page.',
    scope: 'propose',
    input: z.object({ mailbox: MailboxArg, reason: Reason }),
    run: async (auth, a) => propose(auth, a.mailbox, { kind: 'dryrun.request' }, a.reason),
  }),
];

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  error: { code, message },
});

function toolList(scopes: McpScope[]) {
  return TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: 'input' }),
    annotations: { readOnlyHint: t.scope === 'read', destructiveHint: false, openWorldHint: false },
  }));
}

/** Handles one JSON-RPC message; returns null for notifications. */
export async function handleRpc(auth: McpAuth, msg: JsonRpcRequest): Promise<object | null> {
  const isNotification = msg.id === undefined;
  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '');
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : SUPPORTED_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'mailops', title: 'MailOps', version: ENGINE_LATEST_VERSION },
            instructions: INSTRUCTIONS,
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id: msg.id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id: msg.id, result: { tools: toolList(auth.scopes) } };
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const t = TOOLS.find((x) => x.name === name);
        if (!t) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
        if (!auth.scopes.includes(t.scope)) {
          return toolResult(msg.id, { error: `This token lacks the "${t.scope}" scope.` }, true);
        }
        const parsed = t.input.safeParse(msg.params?.arguments ?? {});
        if (!parsed.success) {
          return toolResult(
            msg.id,
            { error: 'Invalid arguments', issues: parsed.error.issues },
            true,
          );
        }
        try {
          return toolResult(msg.id, await t.run(auth, parsed.data as never), false);
        } catch (e) {
          const message = e instanceof HttpError ? e.message : 'Internal error';
          if (!(e instanceof HttpError)) console.error(e);
          return toolResult(msg.id, { error: message }, true);
        }
      }
      default:
        if (isNotification) return null;
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    console.error(e);
    return isNotification ? null : rpcError(msg.id, -32603, 'Internal error');
  }
}

function toolResult(id: JsonRpcRequest['id'], value: unknown, isError: boolean) {
  const structured = Array.isArray(value) ? { items: value } : (value as Record<string, unknown>);
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      structuredContent: structured,
      isError,
    },
  };
}
