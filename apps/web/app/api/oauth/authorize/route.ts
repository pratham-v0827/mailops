import { requireUser } from '@/lib/auth';
import { handle, readJson } from '@/lib/http';
import { approveAuthorization, AuthorizeRequest } from '@/lib/oauth';
import { ensureUser } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The signed-in user allows an MCP client; returns where to send the browser (with the code). */
export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  const req = AuthorizeRequest.parse(await readJson(request));
  return { redirect: await approveAuthorization(user.uid, req, new URL(request.url).origin) };
});
