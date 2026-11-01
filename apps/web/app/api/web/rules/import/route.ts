import { requireUser } from '../../../../../lib/auth';
import { handle, readJson } from '../../../../../lib/http';
import { ImportBody } from '../../../../../lib/import';
import { ensureUser, importRules } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  const body = ImportBody.parse(await readJson(request));
  return { imported: await importRules(user.uid, body.rules) };
});
