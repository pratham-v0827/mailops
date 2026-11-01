import { describe, expect, it } from 'vitest';
import { ImportBody } from './import';
import { ruleIdFor } from './ids';

describe('ImportBody', () => {
  it('accepts valid rules and applies schema defaults', () => {
    const body = ImportBody.parse({
      rules: [
        { label: 'Newsletters', archiveAfterDays: 1, trashAfterDays: 15 },
        { label: 'Banking/Statements', archiveAfterDays: 7, neverDelete: true },
      ],
    });
    expect(body.rules[1]).toMatchObject({ neverDelete: true, trashAfterDays: null, enabled: true });
  });

  it('rejects duplicate labels', () => {
    const res = ImportBody.safeParse({ rules: [{ label: 'A' }, { label: 'A' }] });
    expect(res.success).toBe(false);
  });

  it('rejects invalid rules', () => {
    const res = ImportBody.safeParse({
      rules: [{ label: 'A', neverDelete: true, trashAfterDays: 5 }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects an empty import', () => {
    expect(ImportBody.safeParse({ rules: [] }).success).toBe(false);
  });
});

describe('ruleIdFor', () => {
  it('is stable, Firestore-safe and distinct per label', () => {
    const a = ruleIdFor('Banking/Example Bank/Offers');
    expect(a).toBe(ruleIdFor('Banking/Example Bank/Offers'));
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(ruleIdFor('Banking/Example Bank/offers'));
  });
});
