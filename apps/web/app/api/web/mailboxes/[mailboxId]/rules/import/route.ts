import { handle, readJson } from '../../../../../../../lib/http';
import { ImportBody } from '../../../../../../../lib/import';
import { mailboxContext, type MailboxParams } from '../../../../../../../lib/route-params';
import { importRules } from '../../../../../../../lib/store';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request, ctx: MailboxParams) => {
  const { mailbox } = await mailboxContext(request, ctx);
  const body = ImportBody.parse(await readJson(request));
  return { imported: await importRules(mailbox, body.rules) };
});
