import { isAllowed, parseAllowedEmails } from './allowlist';
import { adminAuth } from './firebase-admin';
import { HttpError } from './http';

export type SessionUser = { uid: string; email: string };

/** Verifies the Firebase ID token in the Authorization header and enforces the invite list. */
export async function requireUser(request: Request): Promise<SessionUser> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Sign in required');

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, 'Session expired; sign in again');
  }

  if (
    !isAllowed(
      decoded.email,
      decoded.email_verified,
      parseAllowedEmails(process.env.ALLOWED_EMAILS),
    )
  ) {
    throw new HttpError(403, 'This MailOps instance is invite-only');
  }
  return { uid: decoded.uid, email: decoded.email! };
}
