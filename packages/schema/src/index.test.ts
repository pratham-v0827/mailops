import { describe, expect, it } from 'vitest';
import { FilterCriteria, LabelName, Proposal, Rule, Settings } from './index';

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
