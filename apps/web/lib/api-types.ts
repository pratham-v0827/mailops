import type { ProposalPayload, Rule, Settings } from '@mailops/schema';

// Shapes returned by /api/web/*. Client-safe (no server imports).

export type MeResponse = {
  email: string;
  settings: Settings;
  ruleCount: number;
  pendingProposals: number;
  engine: {
    lastSeenAt: string | null;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    engineVersion: string | null;
  } | null;
};

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
