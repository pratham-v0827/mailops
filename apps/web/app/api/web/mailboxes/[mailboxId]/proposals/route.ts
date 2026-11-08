import { ProposalPayload } from '@mailops/schema';
import { z } from 'zod';
import { handle, readJson } from '../../../../../../lib/http';
import { mailboxContext, type MailboxParams } from '../../../../../../lib/route-params';
import { createProposal, listProposals } from '../../../../../../lib/store';

export const dynamic = 'force-dynamic';

const Body = z.object({ payload: ProposalPayload, reason: z.string().max(1000).default('') });

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  return { proposals: await listProposals(mailbox, 'pending') };
});

export const POST = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const body = Body.parse(await readJson(request));
  return { id: await createProposal(mailbox, body.payload, 'web', body.reason), status: 'pending' };
});
