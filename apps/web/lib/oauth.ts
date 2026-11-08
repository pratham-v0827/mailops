import { createHash, randomBytes } from 'node:crypto';
import type { McpScope } from '@mailops/schema';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from './firebase-admin';
import { HttpError } from './http';
import { storeOAuthAccessToken } from './mcp-tokens';
import { hashToken } from './tokens';

/**
 * A minimal OAuth 2.1 authorization server for MCP clients (claude.ai custom connectors):
 * dynamic client registration (RFC 7591), authorization code + PKCE S256, refresh token rotation.
 * Sign-in is the dashboard's Google sign-in; the invite list still applies.
 */
export const OAUTH_SCOPES: McpScope[] = ['read', 'propose'];
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86400;
const CODE_TTL_MS = 5 * 60 * 1000;

const clients = () => adminDb().collection('oauthClients');
const codes = () => adminDb().collection('oauthCodes');
const grants = () => adminDb().collection('oauthGrants');

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

const RedirectUri = z
  .string()
  .url()
  .max(500)
  .refine((u) => {
    const x = new URL(u);
    return (
      x.protocol === 'https:' ||
      (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname))
    );
  }, 'Redirect URIs must be https (or http on localhost)');

export const ClientRegistration = z.object({
  redirect_uris: z.array(RedirectUri).min(1).max(10),
  client_name: z.string().max(100).optional(),
  client_uri: z.string().url().max(500).optional(),
  token_endpoint_auth_method: z.enum(['none']).optional(),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
  response_types: z.array(z.enum(['code'])).optional(),
  scope: z.string().max(200).optional(),
});

export async function registerClient(body: z.infer<typeof ClientRegistration>) {
  const clientId = 'mcpc_' + randomBytes(16).toString('base64url');
  const doc = {
    redirect_uris: body.redirect_uris,
    client_name: body.client_name ?? 'MCP client',
    ...(body.client_uri ? { client_uri: body.client_uri } : {}),
    createdAt: FieldValue.serverTimestamp(),
  };
  await clients().doc(clientId).set(doc);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: doc.client_name,
    redirect_uris: body.redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

export async function getClient(clientId: string) {
  if (!/^mcpc_[A-Za-z0-9_-]{22}$/.test(clientId)) return null;
  const snap = await clients().doc(clientId).get();
  if (!snap.exists) return null;
  return {
    clientId,
    name: String(snap.get('client_name')),
    redirectUris: snap.get('redirect_uris') as string[],
  };
}

export function parseScopes(scope: string | null | undefined): McpScope[] {
  if (!scope) return OAUTH_SCOPES;
  const asked = scope.split(/\s+/).filter(Boolean);
  const ok = OAUTH_SCOPES.filter((s) => asked.includes(s));
  return ok.length ? ok : ['read'];
}

export const AuthorizeRequest = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  scope: z.string().optional(),
  state: z.string().max(500).optional(),
  resource: z.string().url().optional(),
});

/** The signed-in user approved the client: returns the redirect URL carrying the code. */
export async function approveAuthorization(
  uid: string,
  req: z.infer<typeof AuthorizeRequest>,
  issuer: string,
) {
  const client = await getClient(req.client_id);
  if (!client) throw new HttpError(400, 'Unknown client; the app must register again');
  if (!client.redirectUris.includes(req.redirect_uri))
    throw new HttpError(400, 'Redirect URI not registered');
  const code = randomBytes(32).toString('base64url');
  await codes()
    .doc(hashToken(code))
    .set({
      uid,
      clientId: req.client_id,
      redirectUri: req.redirect_uri,
      codeChallenge: req.code_challenge,
      scopes: parseScopes(req.scope),
      ...(req.resource ? { resource: req.resource } : {}),
      expireAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
    });
  const url = new URL(req.redirect_uri);
  url.searchParams.set('code', code);
  if (req.state) url.searchParams.set('state', req.state);
  url.searchParams.set('iss', issuer);
  return url.toString();
}

function s256(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function issueTokens(uid: string, clientId: string, scopes: McpScope[]) {
  const access = 'mcpo_' + randomBytes(32).toString('base64url');
  const refresh = 'mcpr_' + randomBytes(32).toString('base64url');
  await storeOAuthAccessToken(access, uid, scopes, clientId, ACCESS_TTL_S);
  await grants()
    .doc(hashToken(refresh))
    .set({
      uid,
      clientId,
      scopes,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + REFRESH_TTL_S * 1000),
    });
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

/** Token endpoint: authorization_code (with PKCE) or refresh_token (rotated on every use). */
export async function exchangeToken(form: URLSearchParams) {
  const grant = form.get('grant_type');
  const clientId = form.get('client_id') ?? '';
  if (!(await getClient(clientId))) throw new OAuthError('invalid_client', 'Unknown client', 401);

  if (grant === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    const ref = codes().doc(hashToken(code));
    const data = await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref); // one use only
      return snap.data()!;
    });
    if (
      !data ||
      (data.expireAt as Timestamp).toMillis() < Date.now() ||
      data.clientId !== clientId ||
      data.redirectUri !== form.get('redirect_uri') ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      s256(verifier) !== data.codeChallenge
    ) {
      throw new OAuthError('invalid_grant', 'Code is invalid, expired, or does not match');
    }
    return issueTokens(String(data.uid), clientId, data.scopes as McpScope[]);
  }

  if (grant === 'refresh_token') {
    const ref = grants().doc(hashToken(form.get('refresh_token') ?? ''));
    const data = await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.update(ref, { revoked: true, rotatedAt: FieldValue.serverTimestamp() });
      return snap.data()!;
    });
    if (
      !data ||
      data.revoked ||
      data.clientId !== clientId ||
      (data.expireAt as Timestamp).toMillis() < Date.now()
    ) {
      throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired');
    }
    return issueTokens(String(data.uid), clientId, data.scopes as McpScope[]);
  }

  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: OAUTH_SCOPES,
    service_documentation: 'https://github.com/pratham-v0827/mailops/blob/main/docs/mcp.md',
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'MailOps',
  };
}
