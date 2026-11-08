import { Rule } from '@mailops/schema';
import { handle, readJson } from '@/lib/http';
import { mailboxContext, type MailboxParams } from '@/lib/route-params';
import { listRules, upsertRule } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  return { rules: await listRules(mailbox) };
});

/**
 * Creates or changes one rule (matched by label). The signed-in user is the approver, so it applies
 * at once; the engine previews a changed rule for `newRulePreviewHours` before acting on it.
 */
export const PUT = handle(async (request: Request, ctx: MailboxParams) => {
  const { user, mailbox } = await mailboxContext(request, ctx);
  return upsertRule(mailbox, Rule.parse(await readJson(request)), user.email);
});
