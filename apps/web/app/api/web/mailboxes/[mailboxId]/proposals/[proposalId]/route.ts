import { z } from 'zod';
import { handle, HttpError, readJson } from '@/lib/http';
import { mailboxContext } from '@/lib/route-params';
import { approveProposal, rejectProposal } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ mailboxId: string; proposalId: string }> };
const Body = z.object({ decision: z.enum(['approve', 'reject']) });

/** Only a signed-in person decides proposals (MCP can create them but never approve). */
export const POST = handle(async (request: Request, ctx: Params) => {
  const { user, mailbox } = await mailboxContext(request, ctx);
  const { proposalId } = await ctx.params;
  if (!/^[A-Za-z0-9]{1,40}$/.test(proposalId)) throw new HttpError(404, 'Proposal not found');
  const { decision } = Body.parse(await readJson(request));
  return decision === 'approve'
    ? approveProposal(mailbox, proposalId, user.email)
    : rejectProposal(mailbox, proposalId, user.email);
});
