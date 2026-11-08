import { requireUser, type SessionUser } from './auth';
import { requireMailbox } from './store';

export type MailboxParams = { params: Promise<{ mailboxId: string }> };

/** Authenticates the caller and resolves a mailbox they own (404 otherwise). */
export async function mailboxContext(request: Request, ctx: MailboxParams) {
  const user: SessionUser = await requireUser(request);
  const { mailboxId } = await ctx.params;
  return { user, mailbox: await requireMailbox(user.uid, mailboxId) };
}
