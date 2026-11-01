import { requireUser } from '../../../../lib/auth';
import { handle } from '../../../../lib/http';
import { listRules } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return { rules: await listRules(user.uid) };
});
