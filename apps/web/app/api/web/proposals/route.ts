import { ProposalPayload } from '@mailops/schema';
import { z } from 'zod';
import { requireUser } from '../../../../lib/auth';
import { handle, readJson } from '../../../../lib/http';
import { createProposal, ensureUser, listProposals } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

const Body = z.object({ payload: ProposalPayload, reason: z.string().max(1000).default('') });

export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return { proposals: await listProposals(user.uid, 'pending') };
});

export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  const body = Body.parse(await readJson(request));
  const id = await createProposal(user.uid, body.payload, 'web', body.reason);
  return { id, status: 'pending' };
});
