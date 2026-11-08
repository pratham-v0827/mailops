import { NewMcpToken } from '@mailops/schema';
import { requireUser } from '@/lib/auth';
import { handle, readJson } from '@/lib/http';
import { issueMcpToken, listMcpTokens } from '@/lib/mcp-tokens';
import { ensureUser } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return { tokens: await listMcpTokens(user.uid) };
});

/** Creates a personal access token for Claude (shown once). */
export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  const body = NewMcpToken.parse(await readJson(request));
  return issueMcpToken(user.uid, body.name, body.scopes);
});
