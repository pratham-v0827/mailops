import { describe, expect, it } from 'vitest';
import { isAllowed, parseAllowedEmails } from './allowlist';

describe('parseAllowedEmails', () => {
  it('splits on commas and whitespace, lowercases, drops blanks', () => {
    expect([...parseAllowedEmails(' A@Example.com, b@example.com\n,, c@example.com ')]).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
  });

  it('is empty when unset', () => {
    expect(parseAllowedEmails(undefined).size).toBe(0);
  });
});

describe('isAllowed', () => {
  const allowed = parseAllowedEmails('owner@example.com');

  it('allows a verified email on the list, case-insensitively', () => {
    expect(isAllowed('Owner@Example.com', true, allowed)).toBe(true);
  });

  it('rejects unverified emails', () => {
    expect(isAllowed('owner@example.com', false, allowed)).toBe(false);
  });

  it('rejects emails not on the list, and everyone when the list is empty', () => {
    expect(isAllowed('stranger@example.com', true, allowed)).toBe(false);
    expect(isAllowed('owner@example.com', true, new Set())).toBe(false);
  });
});
