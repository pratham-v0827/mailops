import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CONNECTOR_TOKEN_PREFIX } from '@mailops/schema';

/** A new connector token: shown to the user once, stored only as its SHA-256 hash. */
export function generateConnectorToken(): string {
  return CONNECTOR_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
