import { randomBytes } from 'node:crypto';
import { MCP_TOKEN_PREFIX, type McpScope } from '@mailops/schema';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './http';
import { hashToken } from './tokens';

/**
 * Access for Claude (MCP). Two kinds share one server-only collection, keyed by SHA-256:
 *   - personal access tokens (`mcp_…`), created on the Settings page, no expiry, revocable
 *   - OAuth access tokens (`mcpo_…`), issued to claude.ai custom connectors, expire after 1 hour
 * Either way MCP can only read and propose; approving stays with the signed-in person.
 */
const col = () => adminDb().collection('mcpTokens');
const MAX_TOKENS = 20;

export type McpAuth = { uid: string; scopes: McpScope[]; tokenId: string };

export async function issueMcpToken(uid: string, name: string, scopes: McpScope[]) {
  const existing = await col().where('uid', '==', uid).where('revoked', '==', false).count().get();
  if (existing.data().count >= MAX_TOKENS) {
    throw new HttpError(400, `At most ${MAX_TOKENS} active tokens; revoke one first`);
  }
  const token = MCP_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const id = hashToken(token);
  await col().doc(id).set({
    uid,
    name,
    scopes,
    kind: 'pat',
    revoked: false,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });
  return { id, token };
}

/** Stores an OAuth access token issued by /api/oauth/token. */
export async function storeOAuthAccessToken(
  token: string,
  uid: string,
  scopes: McpScope[],
  clientId: string,
  ttlSeconds: number,
) {
  await col()
    .doc(hashToken(token))
    .set({
      uid,
      name: `OAuth client ${clientId.slice(0, 12)}`,
      scopes,
      kind: 'oauth',
      clientId,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + ttlSeconds * 1000),
      lastUsedAt: null,
    });
}

const iso = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null;

export async function listMcpTokens(uid: string) {
  const snap = await col().where('uid', '==', uid).where('kind', '==', 'pat').get();
  return snap.docs
    .filter((d) => !d.get('revoked'))
    .map((d) => ({
      id: d.id,
      name: String(d.get('name')),
      scopes: d.get('scopes') as McpScope[],
      createdAt: iso(d.get('createdAt')),
      lastUsedAt: iso(d.get('lastUsedAt')),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function revokeMcpToken(uid: string, id: string) {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new HttpError(404, 'Token not found');
  const ref = col().doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get('uid') !== uid) throw new HttpError(404, 'Token not found');
  await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp() });
}

/** Revokes every OAuth token a user has granted (Settings → Disconnect Claude connectors). */
export async function revokeOAuthTokens(uid: string) {
  const snap = await col().where('uid', '==', uid).where('kind', '==', 'oauth').get();
  const batch = adminDb().batch();
  snap.docs.forEach((d) => batch.update(d.ref, { revoked: true }));
  await batch.commit();
  await adminDb()
    .collection('oauthGrants')
    .where('uid', '==', uid)
    .get()
    .then((g) => {
      const b = adminDb().batch();
      g.docs.forEach((d) => b.update(d.ref, { revoked: true }));
      return b.commit();
    });
  return snap.size;
}

/** Authenticates an MCP request (Authorization: Bearer mcp_… or mcpo_…). */
export async function requireMcp(request: Request): Promise<McpAuth> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^mcpo?_[A-Za-z0-9_-]{43}$/.test(token))
    throw new HttpError(401, 'Missing or malformed token');
  const ref = col().doc(hashToken(token));
  const snap = await ref.get();
  if (!snap.exists || snap.get('revoked')) throw new HttpError(401, 'Token is not valid');
  const exp = (snap.get('expireAt') as Timestamp | undefined)?.toMillis();
  if (exp !== undefined && exp < Date.now()) throw new HttpError(401, 'Token expired');
  const last = (snap.get('lastUsedAt') as Timestamp | null)?.toMillis() ?? 0;
  if (Date.now() - last > 3_600_000) await ref.update({ lastUsedAt: FieldValue.serverTimestamp() });
  return {
    uid: String(snap.get('uid')),
    scopes: snap.get('scopes') as McpScope[],
    tokenId: ref.id,
  };
}
