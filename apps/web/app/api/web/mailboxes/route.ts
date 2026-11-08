import { NewMailbox } from '@mailops/schema';
import { requireUser } from '../../../../lib/auth';
import { handle, readJson } from '../../../../lib/http';
import { addMailbox, ensureUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  return { mailbox: await addMailbox(user.uid, NewMailbox.parse(await readJson(request))) };
});
