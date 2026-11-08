import { requireUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { revokeOAuthTokens } from '@/lib/mcp-tokens';

export const dynamic = 'force-dynamic';

/** Disconnects every OAuth-connected MCP client (claude.ai connectors) for this user. */
export const DELETE = handle(async (request: Request) => {
  const user = await requireUser(request);
  return { revoked: await revokeOAuthTokens(user.uid) };
});
