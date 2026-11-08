import { issueConnectorToken, revokeConnectorToken } from '../../../../../../lib/engine-store';
import { handle } from '../../../../../../lib/http';
import { mailboxContext, type MailboxParams } from '../../../../../../lib/route-params';

export const dynamic = 'force-dynamic';

/** Issues a new connector token (shown once) and revokes the previous one. */
export const POST = handle(async (request: Request, ctx: MailboxParams) => {
  const { user, mailbox } = await mailboxContext(request, ctx);
  return { token: await issueConnectorToken(user.uid, mailbox) };
});

/** Revokes the mailbox's connector token; its engine is disconnected. */
export const DELETE = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  await revokeConnectorToken(mailbox);
  return { revoked: true };
});
