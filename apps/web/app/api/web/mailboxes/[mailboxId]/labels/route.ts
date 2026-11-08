import { handle } from '@/lib/http';
import { mailboxContext, type MailboxParams } from '@/lib/route-params';
import { getMirror } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The labels as last reported by the engine. */
export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const m = await getMirror(mailbox, 'labels');
  return { labels: m.items, updatedAt: m.updatedAt };
});
