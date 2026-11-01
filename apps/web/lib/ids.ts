import { createHash } from 'node:crypto';

/**
 * Stable Firestore document id for a Gmail label. Label names contain "/", which Firestore ids
 * cannot, so the id is a short hash of the exact label name.
 */
export function ruleIdFor(label: string): string {
  return createHash('sha256').update(label, 'utf8').digest('hex').slice(0, 24);
}
