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

export type RulesResponse = { rules: (Rule & { id: string })[] };

export type ProposalView = {
  id: string;
  payload: ProposalPayload;
  source: string;
  status: string;
  reason: string;
  createdAt: string | null;
};
export type ProposalsResponse = { proposals: ProposalView[] };
