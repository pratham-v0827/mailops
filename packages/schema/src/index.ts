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

/** Account-wide settings. Safe defaults: automation off, dry run on, global guards on. */
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
