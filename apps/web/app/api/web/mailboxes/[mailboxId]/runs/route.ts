import { listRuns } from '@/lib/engine-store';
import { handle } from '@/lib/http';
import { mailboxContext, type MailboxParams } from '@/lib/route-params';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const n = Number(new URL(request.url).searchParams.get('limit') ?? 20);
  return { runs: await listRuns(mailbox, Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 20) };
});
