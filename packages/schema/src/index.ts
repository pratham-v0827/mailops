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

/** Per-mailbox settings. Safe defaults: automation off, dry run on, global guards on. */
export const Settings = z.object({
  automationEnabled: z.boolean().default(false),
  dryRun: z.boolean().default(true),
  neverTouchStarred: z.boolean().default(true),
  neverTouchImportant: z.boolean().default(true),
  protectedLabel: z.union([LabelName, z.literal('')]).default('Keep'),
  storeSubjects: z.boolean().default(false),
  retentionDays: z.number().int().min(7).max(365).default(90),
  staleAfterHours: z.number().int().min(1).max(168).default(26),
  timezone: z.string().min(1).default('UTC'),
});
export type Settings = z.infer<typeof Settings>;

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
  z.object({ kind: z.literal('filter.create'), criteria: FilterCriteria, addLabel: LabelName }),
  z.object({ kind: z.literal('dryrun.request'), labels: z.array(LabelName).optional() }),
]);
export type ProposalPayload = z.infer<typeof ProposalPayload>;

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
