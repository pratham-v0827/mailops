/** Parses the ALLOWED_EMAILS env var (comma or whitespace separated) into a normalised set. */
export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Invite-only access: the Google account must have a verified email on the allowlist. */
export function isAllowed(
  email: string | undefined,
  emailVerified: boolean | undefined,
  allowed: Set<string>,
): boolean {
  if (!email || emailVerified !== true) return false;
  return allowed.has(email.trim().toLowerCase());
}
