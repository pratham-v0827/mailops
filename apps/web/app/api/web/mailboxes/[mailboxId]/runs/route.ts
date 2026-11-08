import { listRuns } from '../../../../../../lib/engine-store';
import { handle } from '../../../../../../lib/http';
import { mailboxContext, type MailboxParams } from '../../../../../../lib/route-params';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  return { runs: await listRuns(mailbox, 20) };
});
