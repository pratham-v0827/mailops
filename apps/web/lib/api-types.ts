import type { ProposalPayload, Rule, Settings } from '@mailops/schema';

// Shapes returned by /api/web/*. Client-safe (no server imports).

export type MailboxView = {
  id: string;
  email: string;
  displayName: string;
  /** True once this Gmail account's engine has checked in (M3). */
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
    /** What the engine itself says it runs in (it may be configured outside the dashboard). */
    reportedMode: 'dry' | 'prod' | null;
    reportedAutomationEnabled: boolean | null;
    engineVersion: string | null;
    state: {
      sessionActive?: boolean;
      sessionMode?: 'dry' | 'prod';
      sessionId?: string;
      lastPassCompletedAt?: string;
      nightlyTriggerHour?: number | null;
      usingCachedConfig?: boolean;
    } | null;
  } | null;
};

export type RunView = {
  runId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  mode: 'dry' | 'prod';
  status: string;
  scanned: number;
  archived: number;
  trashed: number;
  protected: number;
  skipped: number;
  errors: number;
  triggerType: string;
  engineVersion: string;
  notes: string;
  receivedAt: string | null;
};
export type RunsResponse = { runs: RunView[] };

export type MeResponse = { email: string; mailboxes: MailboxView[] };

export type RulesResponse = {
  rules: (Rule & { id: string; changedAt: string | null; changedBy: string | null })[];
};

export type ProposalView = {
  id: string;
  payload: ProposalPayload;
  source: string;
  status: string;
  reason: string;
  createdAt: string | null;
  decidedBy?: string | null;
  result?: { ok: boolean; message: string } | null;
};
export type ProposalsResponse = { proposals: ProposalView[] };

export type CommandView = {
  id: string;
  payload: { kind: string } & Record<string, unknown>;
  source: string;
  status: 'queued' | 'sent' | 'done' | 'failed' | string;
  result: { ok: boolean; message: string } | null;
  createdAt: string | null;
  completedAt: string | null;
};
export type CommandsResponse = { commands: CommandView[] };

export type EventView = {
  id: string;
  messageId: string;
  threadId: string;
  at: string;
  runId: string;
  mode: 'dry' | 'prod';
  action: 'archive' | 'trash' | 'protect';
  preview: boolean;
  label: string;
  reason: string;
  ageDays: number;
  senderDomain: string;
  subject?: string;
};
export type EventsResponse = { events: EventView[] };

export type LabelView = {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
};
export type LabelsResponse = { labels: LabelView[]; updatedAt: string | null };

export type FilterView = {
  id: string;
  criteria: Record<string, string | number | boolean>;
  addLabels: string[];
  removeLabels: string[];
  forward?: string;
  health?: { matched30d: number; labelled30d: number; checkedAt: string };
};
export type FiltersResponse = { filters: FilterView[]; updatedAt: string | null };

export type PairInfo = {
  email: string;
  engineVersion: string;
  existingMailboxId: string | null;
  expiresAt: string;
};
