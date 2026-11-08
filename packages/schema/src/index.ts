import { z } from 'zod';

/** Gmail label names: nested with "/", no leading/trailing slash, max 225 chars. */
export const LabelName = z
  .string()
  .trim()
  .min(1)
  .max(225)
  .refine((s) => !s.startsWith('/') && !s.endsWith('/') && !s.includes('//'), {
    message: 'Label names cannot start or end with "/" or contain empty segments',
  });

const Days = z.number().int().min(0).max(36500);

export const RiskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/**
 * A lifecycle rule for one Gmail label: archive after N days, move to Trash after M days,
 * or keep forever. Mirrors the checks the engine runs before every pass.
 */
export const Rule = z
  .object({
    label: LabelName,
    enabled: z.boolean().default(true),
    archiveAfterDays: Days.nullable().default(null),
    trashAfterDays: Days.nullable().default(null),
    neverDelete: z.boolean().default(false),
    protectUnread: z.boolean().default(false),
    protectStarred: z.boolean().default(true),
    risk: RiskLevel.default('LOW'),
    notes: z.string().max(500).default(''),
  })
  .superRefine((r, ctx) => {
    if (r.neverDelete && r.trashAfterDays !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trashAfterDays'],
        message: 'A Never Delete rule cannot have a trash age',
      });
    }
    if (
      r.archiveAfterDays !== null &&
      r.trashAfterDays !== null &&
      r.trashAfterDays < r.archiveAfterDays
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trashAfterDays'],
        message: 'Trash age cannot be earlier than archive age',
      });
    }
  });
export type Rule = z.infer<typeof Rule>;

/**
 * Per-mailbox settings. Safe defaults: automation off, dry run on, global guards on.
 * The engine enforces the guards itself; the dashboard cannot switch them off remotely without
 * the user changing them here.
 */
export const Settings = z.object({
  automationEnabled: z.boolean().default(false),
  dryRun: z.boolean().default(true),
  neverTouchStarred: z.boolean().default(true),
  neverTouchImportant: z.boolean().default(true),
  protectedLabel: z.union([LabelName, z.literal('')]).default('Keep'),
  storeSubjects: z.boolean().default(false),
  retentionDays: z.number().int().min(7).max(365).default(90),
  staleAfterHours: z.number().int().min(1).max(168).default(26),
  timezone: z.string().min(1).max(60).default('UTC'),
  /** Hour (0–23, in `timezone`) of the nightly lifecycle pass. */
  dailyHour: z.number().int().min(0).max(23).default(3),
  /** Per-batch limits (Apps Script allows 6 minutes per execution). */
  maxMessagesPerBatch: z.number().int().min(10).max(150).default(100),
  maxRuntimeSeconds: z.number().int().min(60).max(300).default(210),
  /** Production passes move at most this many messages to Trash; the rest are previewed only. */
  maxTrashPerPass: z.number().int().min(0).max(5000).default(250),
  /** A rule changed in the last N hours runs as a preview even in production. 0 = off. */
  newRulePreviewHours: z.number().int().min(0).max(168).default(24),
  /** The engine emails the account owner when a run fails or the nightly pass is overdue. */
  emailAlerts: z.boolean().default(true),
});
export type Settings = z.infer<typeof Settings>;

/**
 * A partial settings change. Unlike `Settings.partial()`, missing fields stay missing (zod would
 * otherwise fill in defaults and silently reset them).
 */
export const SettingsPatch = z
  .object(
    Object.fromEntries(
      Object.entries(Settings.shape).map(([k, v]) => [k, v.unwrap().optional()]),
    ) as {
      [K in keyof typeof Settings.shape]: z.ZodOptional<
        ReturnType<(typeof Settings.shape)[K]['unwrap']>
      >;
    },
  )
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

/**
 * One Gmail address managed by a MailOps user. A user can have several, each with its own rules,
 * settings and engine. `connected` becomes true once that account's engine checks in (proving
 * the user controls it).
 */
export const NewMailbox = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().max(60).default(''),
});
export type NewMailbox = z.infer<typeof NewMailbox>;

export const MAX_MAILBOXES_PER_USER = 20;

/** Gmail filter criteria (subset of the Gmail API Filter.criteria). */
export const FilterCriteria = z
  .object({
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    negatedQuery: z.string().min(1).optional(),
    hasAttachment: z.boolean().optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined && v !== false), {
    message: 'A filter needs at least one criterion',
  });
export type FilterCriteria = z.infer<typeof FilterCriteria>;

/**
 * Everything the web UI or MCP wants to change becomes a proposal. Only a human approves it;
 * the engine then applies it in the user's own Google account.
 */
export const ProposalPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rule.upsert'), rule: Rule }),
  z.object({ kind: z.literal('label.create'), label: LabelName }),
  z.object({
    kind: z.literal('filter.create'),
    criteria: FilterCriteria,
    addLabel: LabelName,
    /** Also skip the inbox (Gmail "Skip the Inbox (Archive it)"). */
    archive: z.boolean().default(false),
  }),
  z.object({ kind: z.literal('dryrun.request'), labels: z.array(LabelName).optional() }),
]);
export type ProposalPayload = z.infer<typeof ProposalPayload>;

/** Short human-readable description of a proposal, for lists and notifications. */
export function describeProposal(p: ProposalPayload): string {
  switch (p.kind) {
    case 'rule.upsert': {
      const r = p.rule;
      const parts = [
        r.enabled ? null : 'disabled',
        r.archiveAfterDays === null ? null : `archive after ${r.archiveAfterDays} d`,
        r.neverDelete
          ? 'never delete'
          : r.trashAfterDays === null
            ? null
            : `trash after ${r.trashAfterDays} d`,
      ].filter(Boolean);
      return `Rule ${r.label}: ${parts.join(', ') || 'keep'}`;
    }
    case 'label.create':
      return `Create label ${p.label}`;
    case 'filter.create':
      return `Create filter → ${p.addLabel}`;
    case 'dryrun.request':
      return 'Run a dry run';
  }
}

export const ProposalStatus = z.enum(['pending', 'approved', 'rejected', 'applied', 'failed']);
export const ProposalSource = z.enum(['web', 'mcp']);

export const Proposal = z.object({
  payload: ProposalPayload,
  source: ProposalSource,
  status: ProposalStatus.default('pending'),
  reason: z.string().max(1000).default(''),
});
export type Proposal = z.infer<typeof Proposal>;

// ---------------------------------------------------------------------------
// Engine ↔ API (the Apps Script engine authenticates with a per-mailbox connector token)
// ---------------------------------------------------------------------------

/** Connector tokens look like `mops_` + 43 base64url chars (32 random bytes). */
export const CONNECTOR_TOKEN_PREFIX = 'mops_';
export const ConnectorToken = z
  .string()
  .regex(/^mops_[A-Za-z0-9_-]{43}$/, 'Not a MailOps connector token');

const EngineVersion = z.string().trim().min(1).max(40);
const Count = z.number().int().min(0).max(1_000_000);

/** Sent by the engine on connect and around every run. Proves which Gmail account it runs in. */
export const EngineHeartbeat = z.object({
  engineVersion: EngineVersion,
  gmailAddress: z.string().trim().toLowerCase().email(),
  mode: z.enum(['dry', 'prod']).optional(),
  automationEnabled: z.boolean().optional(),
  state: z.lazy(() => EngineState).optional(),
});
export type EngineHeartbeat = z.infer<typeof EngineHeartbeat>;

export const EngineRunStatus = z.enum([
  'SUCCESS',
  'PARTIAL SUCCESS',
  'CONTINUING',
  'PAUSED',
  'FAILED',
  'SKIPPED',
]);

/** One engine execution (one batch of a nightly pass or dry run). Counts only, no email content. */
export const EngineRunReport = z
  .object({
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    sessionId: z.string().max(80).default(''),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    mode: z.enum(['dry', 'prod']),
    status: EngineRunStatus,
    scanned: Count,
    archived: Count,
    trashed: Count,
    protected: Count,
    skipped: Count,
    errors: Count,
    triggerType: z.string().max(60).default(''),
    engineVersion: EngineVersion,
    notes: z.string().max(1000).default(''),
  })
  .refine((r) => new Date(r.endedAt) >= new Date(r.startedAt), {
    message: 'endedAt is before startedAt',
    path: ['endedAt'],
  });
export type EngineRunReport = z.infer<typeof EngineRunReport>;

/**
 * Canonical form for comparing Gmail addresses: lowercase; for gmail.com/googlemail.com also drop
 * dots and "+tags" in the local part (Gmail ignores both, so a.b@gmail.com is ab@gmail.com).
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0]!.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

// ---------------------------------------------------------------------------
// Commands: work the engine carries out in Gmail (queued by the dashboard, or by approving a
// proposal). Rule and settings changes don't need commands: the engine reads them on every sync.
// ---------------------------------------------------------------------------

export const CommandPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('label.create'), label: LabelName }),
  z.object({
    kind: z.literal('filter.create'),
    criteria: FilterCriteria,
    addLabel: LabelName,
    archive: z.boolean().default(false),
  }),
  /** Start a lifecycle pass now. `prod` is refused unless automation is on and dry run is off. */
  z.object({ kind: z.literal('run.start'), mode: z.enum(['dry', 'prod']) }),
  z.object({ kind: z.literal('run.stop') }),
  /** Re-send the label and filter lists now instead of waiting for the daily refresh. */
  z.object({ kind: z.literal('mirror.refresh') }),
]);
export type CommandPayload = z.infer<typeof CommandPayload>;

export const CommandStatus = z.enum(['queued', 'sent', 'done', 'failed']);
export type CommandStatus = z.infer<typeof CommandStatus>;

export const CommandResult = z.object({
  ok: z.boolean(),
  message: z.string().max(1000).default(''),
});
export type CommandResult = z.infer<typeof CommandResult>;

/** Maps an approved proposal to the engine command it needs (null: applied on the server). */
export function commandForProposal(p: ProposalPayload): CommandPayload | null {
  switch (p.kind) {
    case 'rule.upsert':
      return null;
    case 'label.create':
      return { kind: 'label.create', label: p.label };
    case 'filter.create':
      return {
        kind: 'filter.create',
        criteria: p.criteria,
        addLabel: p.addLabel,
        archive: p.archive,
      };
    case 'dryrun.request':
      return { kind: 'run.start', mode: 'dry' };
  }
}

// ---------------------------------------------------------------------------
// Engine → API: audit events and Gmail mirrors
// ---------------------------------------------------------------------------

export const EventAction = z.enum(['archive', 'trash', 'protect']);
export type EventAction = z.infer<typeof EventAction>;

const GmailId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * One lifecycle decision about one message. No body is ever sent; the subject only when the
 * mailbox opts in (settings.storeSubjects).
 */
export const EngineEvent = z.object({
  messageId: GmailId,
  threadId: GmailId,
  at: z.iso.datetime({ offset: true }),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  mode: z.enum(['dry', 'prod']),
  action: EventAction,
  /** True when nothing was changed (dry run, new-rule preview, or the trash limit). */
  preview: z.boolean(),
  label: LabelName,
  reason: z.string().max(200).default(''),
  ageDays: z.number().int().min(0).max(36500),
  senderDomain: z.string().max(253).default(''),
  subject: z.string().max(200).optional(),
});
export type EngineEvent = z.infer<typeof EngineEvent>;

export const EngineEventBatch = z.object({ events: z.array(EngineEvent).min(1).max(500) });

export const MirroredLabel = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(225),
  type: z.enum(['system', 'user']),
  messagesTotal: z.number().int().min(0).optional(),
  messagesUnread: z.number().int().min(0).optional(),
});
export type MirroredLabel = z.infer<typeof MirroredLabel>;

export const LabelMirror = z.object({ labels: z.array(MirroredLabel).max(2000) });

export const MirroredFilter = z.object({
  id: z.string().min(1).max(200),
  criteria: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  addLabels: z.array(z.string().max(225)).max(20).default([]),
  removeLabels: z.array(z.string().max(225)).max(20).default([]),
  forward: z.string().max(254).optional(),
  /** Messages in the last 30 days matching the criteria, and how many of those carry the label. */
  health: z
    .object({
      matched30d: z.number().int().min(0),
      labelled30d: z.number().int().min(0),
      checkedAt: z.iso.datetime({ offset: true }),
    })
    .optional(),
});
export type MirroredFilter = z.infer<typeof MirroredFilter>;

/** `complete` replaces the whole list (removed filters disappear); otherwise entries are merged. */
export const FilterMirror = z.object({
  filters: z.array(MirroredFilter).max(1000),
  complete: z.boolean().default(false),
});

/** Engine state sent with each heartbeat (all optional, for older engines). */
export const EngineState = z.object({
  sessionActive: z.boolean().optional(),
  sessionMode: z.enum(['dry', 'prod']).optional(),
  sessionId: z.string().max(80).optional(),
  lastPassCompletedAt: z.iso.datetime({ offset: true }).optional(),
  nightlyTriggerHour: z.number().int().min(0).max(23).nullable().optional(),
  usingCachedConfig: z.boolean().optional(),
});
export type EngineState = z.infer<typeof EngineState>;

// ---------------------------------------------------------------------------
// Pairing: a new engine links itself to a mailbox without copying tokens around.
// The engine shows a short code; the signed-in user approves it on the dashboard.
// ---------------------------------------------------------------------------

/** 8 characters from an alphabet without look-alikes, shown as XXXX-XXXX. */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PairCode = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, 'Not a pairing code'));

export function formatPairCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export const PairStart = z.object({
  /** Google OpenID token from ScriptApp.getIdentityToken(): proves the Gmail address. */
  identityToken: z.string().min(20).max(4096),
  engineVersion: z.string().trim().min(1).max(40),
});
export const PairPoll = z.object({ deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

// ---------------------------------------------------------------------------
// MCP personal access tokens
// ---------------------------------------------------------------------------

export const MCP_TOKEN_PREFIX = 'mcp_';
export const McpToken = z.string().regex(/^mcp_[A-Za-z0-9_-]{43}$/, 'Not a MailOps MCP token');
export const McpScope = z.enum(['read', 'propose']);
export type McpScope = z.infer<typeof McpScope>;
export const NewMcpToken = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(McpScope).min(1).default(['read', 'propose']),
});
