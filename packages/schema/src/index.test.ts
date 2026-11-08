import { describe, expect, it } from 'vitest';
import {
  canonicalEmail,
  ConnectorToken,
  EngineHeartbeat,
  EngineRunReport,
  FilterCriteria,
  LabelName,
  NewMailbox,
  Proposal,
  Rule,
  Settings,
} from './index';

describe('canonicalEmail', () => {
  it('ignores dots and +tags for Gmail, and case everywhere', () => {
    expect(canonicalEmail('A.B.C+news@Gmail.com')).toBe('abc@gmail.com');
    expect(canonicalEmail('abc@googlemail.com')).toBe('abc@gmail.com');
  });

  it('keeps dots for other domains', () => {
    expect(canonicalEmail('First.Last@Example.com')).toBe('first.last@example.com');
  });
});

describe('ConnectorToken', () => {
  it('accepts the mops_ format and rejects anything else', () => {
    expect(ConnectorToken.safeParse('mops_' + 'a'.repeat(43)).success).toBe(true);
    expect(ConnectorToken.safeParse('mops_short').success).toBe(false);
    expect(ConnectorToken.safeParse('Bearer xyz').success).toBe(false);
  });
});

describe('EngineHeartbeat', () => {
  it('normalises the Gmail address', () => {
    expect(
      EngineHeartbeat.parse({ engineVersion: '2.6.0', gmailAddress: ' Me@Example.com ' })
        .gmailAddress,
    ).toBe('me@example.com');
  });
});

describe('EngineRunReport', () => {
  const base = {
    runId: '20261108-030000-ab12cd34',
    startedAt: '2026-11-08T03:00:00.000Z',
    endedAt: '2026-11-08T03:01:10.000Z',
    mode: 'prod',
    status: 'SUCCESS',
    scanned: 20,
    archived: 12,
    trashed: 4,
    protected: 1,
    skipped: 3,
    errors: 0,
    engineVersion: '2.6.0',
  };

  it('accepts a valid report and fills defaults', () => {
    expect(EngineRunReport.parse(base)).toMatchObject({
      sessionId: '',
      notes: '',
      triggerType: '',
    });
  });

  it('rejects negative counts, bad ids and time travel', () => {
    expect(EngineRunReport.safeParse({ ...base, trashed: -1 }).success).toBe(false);
    expect(EngineRunReport.safeParse({ ...base, runId: '../etc' }).success).toBe(false);
    expect(
      EngineRunReport.safeParse({ ...base, endedAt: '2026-11-08T02:00:00.000Z' }).success,
    ).toBe(false);
  });
});

describe('NewMailbox', () => {
  it('normalises the email and defaults the name', () => {
    expect(NewMailbox.parse({ email: '  Work@Example.COM ' })).toEqual({
      email: 'work@example.com',
      displayName: '',
    });
  });

  it('rejects non-emails', () => {
    expect(NewMailbox.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('Rule', () => {
  it('fills safe defaults', () => {
    const r = Rule.parse({ label: 'Newsletters' });
    expect(r).toMatchObject({
      enabled: true,
      archiveAfterDays: null,
      trashAfterDays: null,
      neverDelete: false,
      protectStarred: true,
      risk: 'LOW',
    });
  });

  it('accepts archive-then-trash', () => {
    expect(
      Rule.safeParse({ label: 'Offers', archiveAfterDays: 1, trashAfterDays: 90 }).success,
    ).toBe(true);
  });

  it('rejects a trash age on a Never Delete rule', () => {
    const res = Rule.safeParse({ label: 'Statements', neverDelete: true, trashAfterDays: 30 });
    expect(res.success).toBe(false);
  });

  it('rejects trashing before archiving', () => {
    const res = Rule.safeParse({ label: 'Alerts', archiveAfterDays: 30, trashAfterDays: 7 });
    expect(res.success).toBe(false);
  });
});

describe('LabelName', () => {
  it.each(['Banking/Offers', 'OTP & Security Alerts', 'A/B/C'])('accepts %s', (n) => {
    expect(LabelName.safeParse(n).success).toBe(true);
  });
  it.each(['', '/Leading', 'Trailing/', 'Double//Slash'])('rejects %j', (n) => {
    expect(LabelName.safeParse(n).success).toBe(false);
  });
});

describe('Settings', () => {
  it('defaults to safe mode', () => {
    expect(Settings.parse({})).toMatchObject({
      automationEnabled: false,
      dryRun: true,
      neverTouchStarred: true,
      neverTouchImportant: true,
      protectedLabel: 'Keep',
      storeSubjects: false,
    });
  });
});

describe('Proposal', () => {
  it('accepts a filter proposal', () => {
    const p = Proposal.parse({
      source: 'mcp',
      payload: {
        kind: 'filter.create',
        criteria: { from: 'news@example.com' },
        addLabel: 'Newsletters',
      },
    });
    expect(p.status).toBe('pending');
  });

  it('rejects an empty filter', () => {
    expect(FilterCriteria.safeParse({}).success).toBe(false);
  });

  it('rejects unknown kinds', () => {
    const res = Proposal.safeParse({ source: 'web', payload: { kind: 'filter.delete' } });
    expect(res.success).toBe(false);
  });
});

describe('commands and proposals', () => {
  it('maps proposals to engine commands', async () => {
    const { commandForProposal } = await import('./index');
    expect(commandForProposal({ kind: 'dryrun.request' })).toEqual({
      kind: 'run.start',
      mode: 'dry',
    });
    expect(commandForProposal({ kind: 'label.create', label: 'A/B' })).toEqual({
      kind: 'label.create',
      label: 'A/B',
    });
    expect(
      commandForProposal({ kind: 'rule.upsert', rule: Rule.parse({ label: 'A' }) }),
    ).toBeNull();
  });

  it('describes proposals', async () => {
    const { describeProposal } = await import('./index');
    expect(
      describeProposal({
        kind: 'rule.upsert',
        rule: Rule.parse({ label: 'News', archiveAfterDays: 7, trashAfterDays: 30 }),
      }),
    ).toBe('Rule News: archive after 7 d, trash after 30 d');
  });

  it('rejects unknown command kinds', async () => {
    const { CommandPayload } = await import('./index');
    expect(CommandPayload.safeParse({ kind: 'mail.delete' }).success).toBe(false);
    expect(CommandPayload.safeParse({ kind: 'run.start', mode: 'prod' }).success).toBe(true);
  });
});

describe('EngineEvent', () => {
  const base = {
    messageId: '1a168f266cabf6ce',
    threadId: '1a168f266cabf6ce',
    at: '2026-11-08T03:00:00.000Z',
    runId: '20261108-030000-abcd1234',
    mode: 'dry',
    action: 'archive',
    preview: true,
    label: 'Newsletters',
    ageDays: 9,
  };
  it('accepts a minimal event and defaults optional fields', async () => {
    const { EngineEvent } = await import('./index');
    const e = EngineEvent.parse(base);
    expect(e.senderDomain).toBe('');
    expect(e.subject).toBeUndefined();
  });
  it('caps batches at 500', async () => {
    const { EngineEventBatch } = await import('./index');
    expect(EngineEventBatch.safeParse({ events: Array(501).fill(base) }).success).toBe(false);
  });
});

describe('PairCode', () => {
  it('normalises case and the dash', async () => {
    const { PairCode, formatPairCode } = await import('./index');
    expect(PairCode.parse('abcd-efgh')).toBe('ABCDEFGH');
    expect(PairCode.safeParse('ABCD-EFG0').success).toBe(false); // 0 is not in the alphabet
    expect(formatPairCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

describe('Settings defaults', () => {
  it('keeps the safe defaults', () => {
    const s = Settings.parse({});
    expect(s.dryRun).toBe(true);
    expect(s.automationEnabled).toBe(false);
    expect(s.maxTrashPerPass).toBe(250);
    expect(s.newRulePreviewHours).toBe(24);
  });
});

describe('SettingsPatch', () => {
  it('does not fill in defaults for missing fields', async () => {
    const { SettingsPatch } = await import('./index');
    expect(SettingsPatch.parse({ dryRun: false })).toEqual({ dryRun: false });
    expect(SettingsPatch.safeParse({ bogus: 1 }).success).toBe(false);
    expect(SettingsPatch.safeParse({ dailyHour: 25 }).success).toBe(false);
  });
});
