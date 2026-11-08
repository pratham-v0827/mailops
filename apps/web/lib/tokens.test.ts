import { ConnectorToken } from '@mailops/schema';
import { describe, expect, it } from 'vitest';
import { generateConnectorToken, hashToken, sameHash } from './tokens';

describe('connector tokens', () => {
  it('match the schema format and are unique', () => {
    const a = generateConnectorToken();
    const b = generateConnectorToken();
    expect(ConnectorToken.safeParse(a).success).toBe(true);
    expect(a).not.toBe(b);
  });

  it('hash deterministically to 64 hex chars', () => {
    const t = generateConnectorToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compare hashes safely', () => {
    const h = hashToken('x');
    expect(sameHash(h, hashToken('x'))).toBe(true);
    expect(sameHash(h, hashToken('y'))).toBe(false);
    expect(sameHash(h, '')).toBe(false);
  });
});
