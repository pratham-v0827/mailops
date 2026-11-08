import { requireUser } from '../../../../lib/auth';
import { handle } from '../../../../lib/http';
import { ensureUser, listMailboxes } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  return { email: user.email, mailboxes: await listMailboxes(user.uid) };
});
