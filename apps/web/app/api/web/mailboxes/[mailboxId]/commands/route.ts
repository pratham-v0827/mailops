import { CommandPayload } from '@mailops/schema';
import { z } from 'zod';
import { handle, readJson } from '@/lib/http';
import { mailboxContext, type MailboxParams } from '@/lib/route-params';
import { listCommands, queueCommand } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  return { commands: await listCommands(mailbox) };
});

const Body = z.object({ payload: CommandPayload });

/** Queues work for the engine; it runs on the engine's next sync (within about 15 minutes). */
export const POST = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const { payload } = Body.parse(await readJson(request));
  return { id: await queueCommand(mailbox, payload, 'web'), status: 'queued' };
});
