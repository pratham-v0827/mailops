import { SettingsPatch } from '@mailops/schema';
import { z } from 'zod';
import { handle, readJson } from '@/lib/http';
import { mailboxContext, type MailboxParams } from '@/lib/route-params';
import { updateMailboxName, updateSettings } from '@/lib/store';

export const dynamic = 'force-dynamic';

const Body = z.object({
  displayName: z.string().trim().max(60).optional(),
  settings: SettingsPatch.optional(),
});

/** Changes a mailbox's display name and/or settings. */
export const PATCH = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const body = Body.parse(await readJson(request));
  if (body.displayName !== undefined) await updateMailboxName(mailbox, body.displayName);
  const settings = body.settings ? await updateSettings(mailbox, body.settings) : undefined;
  return { ok: true, settings };
});
