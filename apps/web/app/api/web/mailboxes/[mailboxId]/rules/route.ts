import { handle } from '../../../../../../lib/http';
import { mailboxContext, type MailboxParams } from '../../../../../../lib/route-params';
import { listRules } from '../../../../../../lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  return { rules: await listRules(mailbox) };
});
