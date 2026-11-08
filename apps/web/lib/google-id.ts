import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './http';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * Verifies a Google OpenID token (from Apps Script's ScriptApp.getIdentityToken()) and returns the
 * verified email. The audience is the engine's own Apps Script OAuth client, which differs per
 * copy, so it isn't pinned; the signature, issuer, expiry and verified email are what matter here.
 */
export async function verifyGoogleIdentity(idToken: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      clockTolerance: 60,
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!email || payload.email_verified !== true) {
      throw new HttpError(401, 'The identity token has no verified email');
    }
    return email;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, 'Identity token is not valid; re-run setup in Apps Script');
  }
}
