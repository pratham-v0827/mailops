import { EventAction } from '@mailops/schema';
import { z } from 'zod';
import { handle } from '@/lib/http';
import { mailboxContext, type MailboxParams } from '@/lib/route-params';
import { listEvents } from '@/lib/store';

export const dynamic = 'force-dynamic';

const Query = z.object({
  action: EventAction.optional(),
  runId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const sp = new URL(request.url).searchParams;
  const q = Query.parse(Object.fromEntries([...sp.entries()].filter(([, v]) => v !== '')));
  return { events: await listEvents(mailbox, q) };
});
