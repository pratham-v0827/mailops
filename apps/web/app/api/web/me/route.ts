import { requireUser } from '../../../../lib/auth';
import { handle } from '../../../../lib/http';
import { countPendingProposals, countRules, ensureUser, getHeartbeat } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  const settings = await ensureUser(user);
  const [ruleCount, pendingProposals, engine] = await Promise.all([
    countRules(user.uid),
    countPendingProposals(user.uid),
    getHeartbeat(user.uid),
  ]);
  return { email: user.email, settings, ruleCount, pendingProposals, engine };
});
